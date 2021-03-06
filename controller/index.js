/* @ flow */
var https = require('https')
var Sm = require('sphericalmercator')
var merc = new Sm({size: 256})
var fs = require('fs')
var Utils = require('../lib/utils.js')
var _ = require('lodash')
var Path = require('path')

var Controller = function (agol, BaseController) {
  /**
   * The primary controller onto which all methods are attached
   * @module Controller
   */
  var controller = BaseController()

  /**
   * Manages shared logic for any request that needs a host or key
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   * @param {function} next - calls the next route handler
   */
   // TODO remove this and just call it from different functions
  controller.setHostKey = function (req, res, next) {
    agol.log.debug(JSON.stringify({route: 'setHostKey', params: req.params, query: req.query}))

    // support POST requests; map body vals to the query
    // (then all same as GET)
    for (var k in req.body) if (req.body[k]) req.query[k] = req.body[k]
    req.params.silent = false
    if (!req.params.id) return next()
    req.optionKey = Utils.createCacheKey(req.params, req.query)
    agol.find(req.params.id, function (err, data) {
      if (err) return res.status(404).send(err)
      req.portal = data.host
      next()
    })
  }

  /**
   * Registers a host with the given id
   * this inserts a record into the db for an ArcGIS instances ie: id -> hostname :: arcgis -> arcgis.com
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.register = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'register', params: req.params, query: req.query}))
    if (!req.body.host) return res.status(400).send('Must provide a host to register')

    agol.register(req.body.id, req.body.host, function (err, id) {
      if (err) return res.status(400).send(err)
      res.json({ 'serviceId': id })
    })
  }

  /**
   * handles a DELETE to remove a registered host from the DB
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.del = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'del', params: req.params, query: req.query}))
    if (!req.params.id) return res.status(400).send('Must specify a service id')

    agol.remove(req.params.id, function (err, data) {
      if (err) return res.status(400).send(err)
      res.json(data)
    })
  }

  /**
   * returns a list of the registered hosts and their ids
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.list = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'list', params: req.params, query: req.query}))
    agol.find(null, function (err, data) {
      if (err) return res.status(500).send(err)
      res.json(data)
    })
  }

  /**
   * looks up a host based on a given id
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.find = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'find', params: req.params, query: req.query}))
    res.status(200).json(req.portal)
  }

  /**
   * get the item metadata from the host
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.getInfo = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'getInfo', params: req.params, query: req.query}))
    var table = Utils.createTableKey(req.params)
    agol.cache.getInfo(table, function (err, info) {
      if (err) return res.status(500).json({error: err.message})
      res.status(200).json(info)
    })
  }

  /**
   * Drops the cache for an item
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.dropResource = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'dropResource', params: req.params, query: req.query}))
    agol.dropResource(req.params.item, req.params.layer || 0, req.query, function (error, itemJson) {
      if (error) return res.status(error.code || 400).send(error)
      res.status(200).json(itemJson)
    })
  }

  /**
   * Forced a drop of the cache for an item and DELETEs all known files
   * used for responding to DELETE calls.
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.deleteItemData = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'deleteItemData', params: req.params, query: req.query}))
    req.query.forceDelete = true
    controller.dropResource(req, res)
  }

  /**
   * Gets a resource from the cache
   *   - status processing return 202
   *   - a file exists for the data
   *   - a new file needs to be created
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.getResource = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'getResource', params: req.params, query: req.query}))
    var table = Utils.createTableKey(req.params)
    var infoOpts = {
      host: req.portal,
      key: table,
      item: req.params.item,
      layer: req.params.layer || 0
    }
    agol.getInfo(infoOpts, function (err, info) {
      if (err) return controller._returnStatus(req, res, info, err)
      switch (info.status) {
        case 'Cached':
          return controller._handleCached(req, res, info)
        case 'Processing':
          return controller._returnStatus(req, res, info)
        case 'Expired':
          return controller._handleExpired(req, res, info)
        case 'Failed':
          return controller._handleFailed(req, res, info)
        case 'Unavailable':
          return controller._handleUnavailable(req, res, info)
        default:
          res.status(500).json({error: 'Unrecognized status'})
      }
    })
  }

  /**
   * Handles requests for data when the resource is cached
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   * @param {object} info - information about a arcgis online item
   * @private
   */
  controller._handleCached = function (req, res, info) {
    agol.log.debug(JSON.stringify({route: '_handleCached', params: req.params, query: req.query}))
    var options = Utils.createExportOptions(req, info)

    agol.files.exists(options.filePath, options.fileName, function (exists, path) {
      if (path) return controller._returnFile(req, res, Path.join(options.filePath, options.fileName))
      var exportStatus = Utils.determineStatus(req, info)
      var error = exportStatus === 'fail' ? new Error('Export process failed') : undefined
      if (error) error.code = 500
      if (['queued', 'start', 'progress', 'fail'].indexOf(exportStatus) > -1) return controller._returnStatus(req, res, info, error)
      // only enqueue a job if it's not already queued or running
      agol.generateExport(options, function (err, status, created) {
        controller._returnStatus(req, res, status, err)
      })
    })
  }

  /**
   * Handles the case when something other than 200 needs to be returned
   *
   * @param {object} req - the incoming request
   * @param {object} res - the outgoing response
   * @param {object} info - item's info doc
   * @param {object} error - an error from trying to fetch data
   * @private
   */
  controller._returnStatus = function (req, res, info, error) {
    agol.log.debug(JSON.stringify({route: '_returnStatus', params: req.params, query: req.query}))
    if (req.params.silent) return
    info = info || {}
    var processingTime = Utils.processingTime(info, req.optionKey)
    var response = {processingTime: processingTime, status: 'Processing'}
    // we shouldnt try to get count from the database if the table doesn't exist yet
    if ((!info.status || info.status === 'Unavailable') && !error) return res.status(202).json(response)
    if (error) {
      response.error = Utils.failureMsg(error)
      response.status = 'Failed'
      return res.status(error.code || 502).json(response)
    }
    var table = Utils.createTableKey(req.params)
    agol.cache.getCount(table, {}, function (err, count) {
      var code
      if (err) agol.log.error('Failed to get count of rows in the DB' + ' ' + err)
      response.count = count
      info.generating = info.generating || {}
      response.generating = info.generating[req.optionKey] || {}
      if (info.error && info.error.message) {
        response.error = info.error
        code = 502
      } else if (response.generating[req.params.format] === 'fail') {
        response.error = 'Export job failed'
        code = 500
      }

      if (response.error) response.status = 'Failed'

      res.status(code || 202).json(response)
    })
  }

  /**
   * Handles the case when data requested is expired
   *
   * @param {object} req - the incoming request
   * @param {object} res - the outgoing response
   * @params {object} info - item's info doc
   * @private
   */
  controller._handleExpired = function (req, res, info) {
    agol.log.debug(JSON.stringify({route: '_handleExpired', params: req.params, query: req.query}))
    agol.dropResource(req.params.item, req.params.layer, {layer: req.params.layer}, function (err) {
      if (err) agol.log.error('Unable to drop expired resource: ' + req.params.item + '_' + req.params.layer)
      agol.log.info('Successfully dropped expired resource: ' + req.params.item + '_' + req.params.layer)
      controller.getResource(req, res)
    })
  }

  /**
   * Respond to a requests with a "processing" response
   *
   * @param {object} req - the incoming request
   * @param {object} res - the outgoing response
   * @params {object} info - item's info doc
   * @private
   */
  controller._handleFailed = function (req, res, info) {
    agol.log.debug(JSON.stringify({route: '_handleFailed', params: req.params, query: req.query}))
    if (Date.now() - info.retrieved_at > (30 * 60 * 1000)) {
      agol.dropResource(req.params.item, req.params.layer, null, function (err) {
        if (err) agol.log.error('Unable to drop failed resource: ' + req.params.item + '_' + req.params.layer)
        agol.log.info('Successfully reset failed resource: ' + req.params.item + '_' + req.params.layer)
        controller.getResource(req, res)
      })
    } else {
      controller._returnStatus(req, res, info)
    }
  }

  /**
   * Respond to a requests with a "processing" response
   *
   * @param {object} req - the incoming request
   * @param {object} res - the outgoing response
   * @params {object} info - item's info doc
   * @private
   */
  controller._handleUnavailable = function (req, res, info) {
    agol.log.debug(JSON.stringify({route: '_handleUnavailable', params: req.params, query: req.query}))
    var options = Utils.createCacheOptions(req)
    agol.cacheResource(options, function (err, status) {
      controller._returnStatus(req, res, status, err)
    })
  }

  /**
   * Get the expiration date for a resource
   *
   * @param {object} req - the incoming request
   * @param {object} res - the outgoing response
   */
  controller.getExpiration = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'getExpiration', params: req.params, query: req.query}))
    var table = Utils.createTableKey(req.params)
    agol.getExpiration(table, function (err, expiration) {
      if (err) return res.status(404).json({error: err.message})
      res.status(200).json({expires_at: new Date(expiration)})
    })
  }

  /**
   * Set the expiration date for a resource
   *
   * @params {object} req - the incoming request
   * @params {object} res - the outgoing response
   */
  controller.setExpiration = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'setExpiration', params: req.params, query: req.query}))
    var table = Utils.createTableKey(req.params)
    agol.setExpiration(table, req.body.expires_at, function (err, timestamp) {
      if (!err) return res.status(200).json({expires_at: new Date(timestamp).toISOString()})
      if (err.message === 'Resource not found') {
        var options = Utils.createCacheOptions(req)
        options.expiration = timestamp
        agol.cacheResource(options, function (err, json) {
          if (err) return res.status(500).json(err)
          res.status(201).json({status: 'Processing', expires_at: new Date(timestamp).toISOString()})
        })
      } else {
        res.status(400).json({error: err.message})
      }
    })
  }

  /**
   * Stub a route redirect to make testing private functions easier
   */
  controller.testRoute = function (req, res) {
    controller.testMethod(req, res)
  }

  /**
   * Stub a method for test route than can be easily wrapped
   */
  controller.testMethod = function (req, res) {
    res.status(418).send('Nothing to see here.')
  }

  /**
   * Returns a file as either a URL or an actual file download
   *
   * @params {object} request object
   * @params {object} response object
   * @params {string} path - the path the file
   * @params {string} name - the name of the file
   * @private
   */
  controller._returnFile = function (req, res, filePath) {
    agol.log.debug(JSON.stringify({route: '_returnFile', params: req.params, query: req.query, filePath: filePath}))

    if (req.query.url_only) return res.json({url: Utils.replaceUrl(req)})

    // forces browsers to download
    res = Utils.setHeaders(res, Path.basename(filePath), req.params.format)

    agol.files.createReadStream(filePath).pipe(res)
  }

  /**
   * Handles all requests for FeatureServices
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.featureserver = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'featureserver', params: req.params, query: req.query}))
    var table = Utils.createTableKey(req.params)
    agol.getInfo({key: table, item: req.params.item, host: req.portal}, function (err, info) {
      if (err) return res.status(500).json({error: err.message})
      if (info.status === 'Expired') return controller._expireServiceData(req, res)
      controller._fetchServiceData(req, res)
    })
  }

  /**
   * Handles the case when the data for a feature service is expired
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   * @private
   */
  controller._expireServiceData = function (req, res) {
    agol.log.debug(JSON.stringify({route: '_expireServiceData', params: req.params, query: req.query}))
    agol.cache.drop(req.params.item, req.params.layer, function (err) {
      if (err) agol.log(err)
      controller._fetchServiceData(req, res)
    })
  }

  /**
   * Handles fetching data and returning it as a feature service
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   * @private
   */
  controller._fetchServiceData = function (req, res) {
    agol.log.debug(JSON.stringify({route: '_fetchServiceData', params: req.params, query: req.query}))
    // until koop-pgcache supports JSONB we need to fetch all the features from the cache in order to
    // give accurate responses
    req.query.limit = req.query.limit || req.query.resultRecordCount || 1000000000
    var options = {item: req.params.item, layer: req.params.layer || 0, host: req.portal, query: req.query}
    agol.cacheResource(options, function (error, info, data) {
      if (error) return res.status(error.code || 500).json(error.error || error)
      var fsQuery = Utils.setServiceDefaults(req.params, req.query)
      req.query = _.omit(fsQuery, ['geometry', 'where'])
      // the data must be passed in to controller.processFeatureServer as the first element in an array
      // that should be removed in koop 3.0
      controller.processFeatureServer(req, res, null, [data], req.query.callback)
    })
  }

  /**
   * Handles incoming requests for geohashes
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.getGeohash = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'getGeohash', params: req.params, query: req.query}))

    var hashOpts = Utils.createGeohashOptions(req)
    agol.files.exists(hashOpts.filePath, hashOpts.fileName, function (exists, path, fileInfo) {
      var options = {key: hashOpts.key, host: req.portal, item: req.params.item, layer: req.params.layer || 0}
      agol.getInfo(options, function (err, info) {
        if (err) return res.status(500).json(err)
        if (exists) {
          // this is logic for the expiration of the geohash itself
          fileInfo = fileInfo || {}
          info.expired = new Date(info.retrieved_at) > new Date(fileInfo.LastModified)
          info.geohash_written = fileInfo.LastModified
          // always return a geohash to the client if it exists
          controller._returnGeohash(req, res, path, info)
          // we set silent here so that we can take advantage of the controller functions
          // that handle creating geohashes and caching resources without trying to send the response twice
          req.params.silent = true
          if (info.expired) controller._createGeohash(req, res, hashOpts, info)
          if (info.status.expired) {
            agol.dropResource(req.params.item, req.params.layer, {}, function (err) {
              if (err) agol.log.error('Error dropping resource', err)
            })
          }
        } else {
          if (info.geohashStatus === 'Processing') return res.status(202).json({status: 'Processing'})
          switch (info.status) {
            case 'Cached':
              return controller._createGeohash(req, res, hashOpts, info)
            case 'Processing':
              return controller._returnStatus(req, res, info)
            case 'Expired':
              return controller._createGeohash(req, res, hashOpts, info)
            case 'Unavailable':
              return controller._handleUnavailable(req, res, info)
            case 'Failed':
              return controller._handleFailed(req, res, info)
            default:
              agol.log.error(req.params, req.query, err, info)
              return res.status(500).json({error: 'Unknown status'})
          }
        }
      })
    })
  }

  /**
   * Returns a geohash proxied from s3 and sets headers
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   * @param {string} path - the path to the geohash on the filesystem
   * @param {object} info - the resource's info doc
   * @private
   */
  controller._returnGeohash = function (req, res, path, info) {
    agol.log.debug(JSON.stringify({route: '_returnGeohash', params: req.params, query: req.query}))
    res.contentType('application/json')
    if (info.expired || info.status === 'Expired') {
      res.set('X-Expired', info.geohash_written)
      res.set('Access-Control-Allow-Headers', 'X-Expired')
      res.set('Access-Control-Expose-Headers', 'X-Expired')
    }
    if (path.substr(0, 4) !== 'http') return res.sendFile(path)
    // Proxy to s3 urls allows us to not show the URL
    https.get(path, function (proxyRes) {
      if (proxyRes.headers['content-length'] === 0) return res.status(500).json({error: 'Empty geohash'})
      proxyRes.pipe(res)
    })
  }

  /**
   * Handles creation of a geohash async
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   * @param {object} options - filters to be placed on the data
   * @param {object} info - the resource's info doc
   * @private
   */
  controller._createGeohash = function (req, res, options, info) {
    agol.log.debug(JSON.stringify({route: '_createGeohash', params: req.params, query: req.query}))
    agol.buildGeohash(info, options, function (err, agg) {
      if (req.params.silent) return
      if (err) return res.status(500).json(err)
      if (!agg) return res.status(202).json({status: 'Generating Geohash'})
      res.status(200).json(agg)
    })
  }

  /**
   * Gets the total number of jobs on the queue
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.getQueueLength = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'getQueueLength', params: req.params, query: req.query}))
    if (!agol.featureQueue) return res.status(400).json({error: 'Feature queue is not enabled'})
    agol.featureQueue.length('agol', function (err, length) {
      if (err) return res.status(500).send(err)
      var response = {length: length}
      res.status(200).json(response)
    })
  }

  /**
   * Get all the jobs that are currently on the queue
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.getQueueWorkingCount = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'getQueueWorking', params: req.params, query: req.query}))
    if (!agol.featureQueue) return res.status(400).json({error: 'Feature queue is not enabled'})
    agol.featureQueue.allWorkingOn(function (err, workers) {
      if (err) return res.status(500).send(err)
      var working = _.filter(workers, function (w) {
        return typeof w === 'object'
      })
      res.status(200).json(working.length)
    })
  }

  /**
   * Gets the status of the workers and running jobs
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.getQueueWorkers = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'getQueueWorkers', params: req.params, query: req.query}))
    if (!agol.featureQueue) return res.status(400).json({error: 'Feature queue is not enabled'})
    agol.featureQueue.allWorkingOn(function (err, working) {
      if (err) return res.status(500).send(err)
      res.status(200).json(working)
    })
  }

  /**
   * Drops and failed jobs from the cache and queue
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.clearFailedJobs = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'clearFailedJobs', params: req.params, query: req.query}))
    if (!agol.featureQueue) return res.status(400).json({error: 'Feature queue is not enabled'})
    agol.dropAndRemoveFailed(function (err, report) {
      if (err) return res.status(500).json({error: err.message})
      res.status(200).json(report)
    })
  }

  /**
   * Renders a preview on a map
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.preview = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'preview', params: req.params, query: req.query}))
    agol.log.info('Render preview ' + JSON.stringify(req.params))
    res.render(__dirname + '/../views/demo', { locals: { host: req.params.id, item: req.params.item } })
  }

  /**
   * Handles requests for tiles
   *
   * @param {object} req - the incoming request object
   * @param {object} res - the outgoing response object
   */
  controller.tiles = function (req, res) {
    agol.log.debug(JSON.stringify({route: 'tiles', params: req.params, query: req.query}))
    var callback = req.query.callback
    var key
    var layer = req.params.layer || 0

    // if no format given default to png
    if (!req.params.format) {
      req.params.format = 'png'
    }

    // Get the tile and send the response to the client
    var _send = function (err, data) {
      if (err) {
        return res.status(500).send(err)
      }
      req.params.name = (data && data[0]) ? data[0].name : null
      req.params.key = req.params.item + '_' + layer
      agol.tileGet(req.params, (data && data[0]) ? data[0] : {}, function (err, tile) {
        if (err) {
          return res.status(err.code || 500).send(err.message || 'Unknown error while creating the tile')
        }

        if (req.params.format === 'pbf') {
          res.setHeader('content-encoding', 'deflate')
        }

        if (req.params.format === 'png' || req.params.format === 'pbf') {
          return res.sendFile(tile)
        }

        if (callback) {
          return res.send(callback + '(' + fs.readFileSync(JSON.parse(tile)) + ')')
        }
        return res.json(JSON.parse(fs.readFileSync(tile)))
      })
    }

    // build the geometry from z,x,y
    var bounds = merc.bbox(req.params.x, req.params.y, req.params.z, false, '4326')
    req.query.geometry = {
      xmin: bounds[0],
      ymin: bounds[1],
      xmax: bounds[2],
      ymax: bounds[3],
      spatialReference: { wkid: 4326 }
    }

    var _sendImmediate = function (file) {
      if (req.params.format === 'pbf') {
        res.setHeader('content-encoding', 'deflate')
      }

      if (req.params.format === 'png' || req.params.format === 'pbf') {
        return res.sendFile(file)
      }

      if (callback) {
        return res.send(callback + '(' + JSON.parse(fs.readFileSync(file)) + ')')
      }

      return res.json(JSON.parse(fs.readFileSync(file)))
    }

    key = [req.params.item, layer].join('_')
    var file = agol.files.localDir + '/tiles/'
    file += key + '/' + req.params.format
    file += '/' + req.params.z + '/' + req.params.x + '/' + req.params.y + '.' + req.params.format

    var jsonFile = file.replace(/png|pbf|utf/g, 'json')

    // if the json file alreadty exists, dont hit the db, just send the data
    if (fs.existsSync(jsonFile) && !fs.existsSync(file)) {
      _send(null, fs.readFileSync(jsonFile))
    } else if (!fs.existsSync(file)) {
      // if we have a layer then pass it along
      if (req.params.layer) {
        req.query.layer = req.params.layer
      }

      var factor = 0.1
      req.query.simplify = ((Math.abs(req.query.geometry.xmin - req.query.geometry.xmax)) / 256) * factor

      // make sure we ignore the query limit of 2k
      req.query.enforce_limit = false

      // Get the item
      agol.cache.get(req.params.item, req.params.layer, req.query, function (error, itemJson) {
        if (error) {
          if (error.message === 'Resource not found') return controller.getResource(req, res)
          if (itemJson && itemJson.type === 'Image Service' && req.params.format === 'png') {
            agol.getImageServiceTile(req.params, function (err, newFile) {
              if (err) {
                return res.status(500).send(err)
              }
              _sendImmediate(newFile)
            })
          } else {
            res.status(error.code || 500).send(error)
          }
        } else {
          _send(error, itemJson.data)
        }
      })
    } else {
      _sendImmediate(file)
    }
  }

  return controller
}

module.exports = Controller
