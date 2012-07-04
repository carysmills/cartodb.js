/**
* classes to manage maps
*/

/**
* Map layer, could be tiled or whatever
*/
cdb.geo.MapLayer = Backbone.Model.extend({

  defaults: {
    visible: true,
    type: 'Tiled'
  }
});

// Good old fashioned tile layer
cdb.geo.TileLayer = cdb.geo.MapLayer.extend({
  getTileLayer: function () {
    return new L.TileLayer(this.get('urlTemplate'));
  }
});

// CartoDB layer
cdb.geo.CartoDBLayer = cdb.geo.MapLayer.extend({
  defaults: {
    type:           'CartoDB',
    query:          "SELECT * FROM {{table_name}}",
    opacity:        0.99,
    auto_bound:     false,
    debug:          false,
    visible:        true,
    tiler_domain:   "cartodb.com",
    tiler_port:     "80",
    tiler_protocol: "http",
    sql_domain:     "cartodb.com",
    sql_port:       "80",
    sql_protocol:   "http",
    extra_params:   {},
    cdn_url:        null
  },

  initialize: function() {
    _.bindAll(this, 'getTileLayer', '_getInteractiveLayer', '_getStaticTileLayer', '_bindWaxEvents');
    this.mapView = this.attributes.mapView;
  },

  _generateURL: function(type){

    // Check if we are using a CDN and in that case, return the provided URL
    if ( this.get("cdn_url") ) {
      return this.get("cdn_url");
    }

    var // let's build the URL
    username     = this.get("user_name"),
    domain       = this.get("sql_domain"),
    port         = this.get("sql_port"),
    protocol     = this.get("sql_protocol");

    if (type != "sql") {
      protocol = this.get("tiler_protocol");
    }

    return protocol + "://" + ( username ? username + "." : "" ) + domain + ( port != "" ? (":" + port) : "" );

  },

  /**
  * Appends callback to the urls
  *
  * @params {String} Tile url
  * @params {String} Tile data
  * @return {String} Tile url parsed
  */
  _addUrlData: function (url, data) {
    url += this._parseUri(url).query ? '&' : '?';
    return url += data;
  },

  /**
  * Parse URI
  *
  * @params {String} Tile url
  * @return {String} URI parsed
  */
  _parseUri: function (str) {
    var o = {
      strictMode: false,
      key: ["source", "protocol", "authority", "userInfo", "user", "password", "host", "port", "relative", "path", "directory", "file", "query", "anchor"],
      q:   {
        name:   "queryKey",
        parser: /(?:^|&)([^&=]*)=?([^&]*)/g
      },
      parser: {
        strict: /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,
        loose:  /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
      }
    },
    mode   = o.parser[o.strictMode ? "strict" : "loose"].exec(str),
    uri = {},
    i   = 14;

    while (i--) uri[o.key[i]] = mode[i] || "";

    uri[o.q.name] = {};

    uri[o.key[12]].replace(o.q.parser, function ($0, $1, $2) {
      if ($1) uri[o.q.name][$1] = $2;
    });

    return uri;
  },

  /**
  * Generate tilejson for wax
  *
  * @return {Object} Options for L.TileLayer
  */
  _generateTileJson: function () {
    var
    core_url = this._generateURL("tiler"),
    base_url = core_url + '/tiles/' + this.get("table_name") + '/{z}/{x}/{y}',
    tile_url = base_url + '.png',
    grid_url = base_url + '.grid.json';

    var
    query         = this.get("query"),
    tableName     = this.get("table_name"),
    tileStyle     = this.get("tile_style"),
    interactivity = this.get("interactivity");
    extraParams   = this.get("extra_params");

    if (query) {
      var query = 'sql=' + encodeURIComponent(query.replace(/\{\{table_name\}\}/g, tableName));
      tile_url = this._addUrlData(tile_url, query);
      grid_url = this._addUrlData(grid_url, query);
    }

    _.each(extraParams, function(value, name) {
      tile_url = this._addUrlData(tile_url, name + "=" + value);
      grid_url = this._addUrlData(grid_url, name + "=" + value);
    });

    if (tileStyle) {
      var style = 'style=' + encodeURIComponent(tileStyle.replace(/\{\{table_name\}\}/g, tableName));
      tile_url = this._addUrlData(tile_url, style);
      grid_url = this._addUrlData(grid_url, style);
    }

    if (interactivity) {
      var interactivity = 'interactivity=' + encodeURIComponent(interactivity.replace(/ /g,''));
      tile_url = this._addUrlData(tile_url, interactivity);
      grid_url = this._addUrlData(grid_url, interactivity);
    }

    // Build up the tileJSON
    return {
      blankImage: '../img/blank_tile.png',
      tilejson: '1.0.0',
      scheme: 'xyz',
      tiles: [tile_url],
      grids: [grid_url],
      tiles_base: tile_url,
      grids_base: grid_url,
      opacity: this.get("opacity"),
      formatter: function(options, data) {
        return data
      }
    };
  },

  /**
  * Get the point of the event in the map
  *
  * @params {Object} Map object
  * @params {Object} Wax event object
  */
  _findPos: function (map,o) {
    var
    curleft = curtop = 0,
    obj     = map._container;

    if (obj.offsetParent) {

      do { // Modern browsers
        curleft += obj.offsetLeft;
        curtop += obj.offsetTop;
      } while (obj = obj.offsetParent);

      return map.containerPointToLayerPoint(new L.Point(o.pos.x - curleft,o.pos.y - curtop))

    } else { // IE
      return map.mouseEventToLayerPoint(o.e)
    }
  },

  /**
  * Bind events for wax interaction
  *
  * @param {Object} Layer map object
  * @param {Event} Wax event
  */
  _bindWaxEvents: function(map, o) {

    var
    layer_point = this._findPos(map, o),
    latlng      = map.layerPointToLatLng(layer_point);

    var featureOver  = this.get("featureOver");
    var featureClick = this.get("featureClick");

    switch (o.e.type) {
      case 'mousemove':
        if (featureOver) {
          return featureOver(o.e,latlng,o.pos,o.data);
        } else {
          if (this.get("debug")) throw('featureOver function not defined');
        }
      break;
    case 'click':
      if (featureClick) {
        featureClick(o.e,latlng,o.pos,o.data);
      } else {
        if (this.get("debug")) throw('featureClick function not defined');
      }
    break;
  case 'touched':
    if (featureClick) {
      featureClick(o.e,latlng,o.pos,o.data);
    } else {
      if (this.get("debug")) throw('featureClick function not defined');
    }
    break;
  default: break;
    }
  },

  getTileLayer: function() {

    if (this.get("interactivity")) {
      return this._getInteractiveLayer();
    }

    return this._getStaticTileLayer();
  },

  _getInteractiveLayer: function() {

    var self = this;

    this.tilejson = this._generateTileJson();
    this.layer    = new wax.leaf.connector(this.tilejson);

    var featureOn  = function(o) { self._bindWaxEvents(self.mapView.map_leaflet, o)};
    var featureOut = function(){

      var featureOut = self.get("featureOut");

      if (featureOut) {
        return featureOut && featureOut();
      } else {
        if (self.get("debug")) throw('featureOut function not defined');
      }
    };

    this.interaction = wax.leaf.interaction()
    .map(this.mapView.map_leaflet)
    .tilejson(this.tilejson)
    .on('on',  featureOn)
    .on('off', featureOut);

    return this.layer;
  },


  _getStaticTileLayer: function() {

    var // add the cartodb tiles
    style     = this.get("tile_style"),
    tableName = this.get("table_name"),
    query     = this.get("query");

    tileStyle  = (style) ? encodeURIComponent(style.replace(/\{\{table_name\}\}/g, tableName )) : '';
    query      = encodeURIComponent(query.replace(/\{\{table_name\}\}/g, tableName ));

    var cartodb_url = this._generateURL("tiler") + '/tiles/' + tableName + '/{z}/{x}/{y}.png?sql=' + query +'&style=' + tileStyle;

    _.each(this.attributes.extra_params, function(value, name) {
      cartodb_url += "&" + name + "=" + value;
    });

    return new L.TileLayer(cartodb_url, { attribution:'CartoDB', opacity: this.get("opacity") });
  }

});

cdb.geo.MapLayers = Backbone.Collection.extend({
  model: cdb.geo.MapLayer
  });

  /**
  * map model itself
  */
  cdb.geo.Map = Backbone.Model.extend({

    defaults: {
      center: [0, 0],
      zoom: 9
    },

    initialize: function() {
      this.layers = new cdb.geo.MapLayers();
    },

    setZoom: function(z) {
      this.set({zoom:  z});
    },

    getZoom: function() {
      return this.get('zoom');
    },

    setCenter: function(latlng) {
      this.set({center: latlng});
    },

    /**
    * add a layer to the map
    */
    addLayer: function(layer) {
      this.layers.add(layer);
    }

  });


  /**
  * base view for all impl
  */
  cdb.geo.MapView = cdb.core.View.extend({

    initialize: function() {
      if(this.options.map === undefined) {
        throw new Exception("you should specify a map model");
      }
      this.map = this.options.map;
      this.add_related_model(this.map);
    }

  });

  /**
  * leatlef impl
  */
  cdb.geo.LeafletMapView = cdb.geo.MapView.extend({

    initialize: function() {

      _.bindAll(this, '_addLayer', '_setZoom', '_setCenter');

      cdb.geo.MapView.prototype.initialize.call(this);

      var self = this;

      this.map_leaflet = new L.Map(this.el, {
        zoomControl: false
      });

      this.map.layers.bind('add', this._addLayer);

      this._bindModel();

      //set options
      this._setCenter(this.map, this.map.get('center'));
      this._setZoom(this.map, this.map.get('zoom'));

      this.map_leaflet.on('zoomend', function() {
        self._setModelProperty({zoom: self.map_leaflet.getZoom()});
      }, this);

      this.map_leaflet.on('drag', function () {
        var c = self.map_leaflet.getCenter();
        self._setModelProperty({center: [c.lat, c.lng]});
      }, this);
    },

    /** bind model properties */
    _bindModel: function() {
      this.map.bind('change:zoom', this._setZoom, this);
      this.map.bind('change:center', this._setCenter, this);
    },

    /** unbind model properties */
    _unbindModel: function() {
      this.map.unbind('change:zoom', this._setZoom, this);
      this.map.unbind('change:center', this._setCenter, this);
    },

    /**
    * set model property but unbind changes first in order to not create an infinite loop
    */
    _setModelProperty: function(prop) {
      this._unbindModel();
      this.map.set(prop);
      this._bindModel();
    },

    _setZoom: function(model, z) {
      this.map_leaflet.setZoom(z);
    },

    _setCenter: function(model, center) {
      this.map_leaflet.panTo(new L.LatLng(center[0], center[1]));
    },

    _addLayer: function(layer) {
      var lyr;

      if ( layer.get('type') == "Tiled" ) {
        lyr = layer.getTileLayer();
      }

      if ( layer.get('type') == 'CartoDB') {
        lyr = layer.getTileLayer();
      }

      if (lyr) {
        this.map_leaflet.addLayer(lyr);
      } else {
        cdb.log.error("layer type not supported");
      }
    }
  });
