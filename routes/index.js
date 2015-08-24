module.exports = {
  'post /agol': 'register',
  'get /agol': 'list',
  'get /agolworkers': 'getQueueCounts',
  'get /agol/:id': 'find',
  'get /agol/:id/*': 'setHostKey',
  'put /agol/:id/*': 'setHostKey',
  'post /agol/:id/*': 'setHostKey',
  'delete /agol/:id': 'del',
  'delete /agol/:id/:item/:layer': 'deleteItemData',
  'get /agol/:id/:item/:layer/geohash': 'getGeohash',
  'get /agol/:id/:item.:format': 'findItemData',
  'get /agol/:id/:item/:layer.:format': 'findItemData',
  'get /agol/:id/:item/:layer': 'findItemData',
  'get /agol/:id/:item': 'findItem',
  'get /agol/:id/:item/:layer/drop': 'dropItem',
  'get /agol/:id/:item/data/:layer': 'findItemData',
  'get /agol/:id/:item/data': 'findItemData',
  'get /agol/:id/:item/thumbnail': 'thumbnail',
  'get /agol/:id/:item/thumbnail/:layer': 'thumbnail',
  'get /agol/:id/:item/:layer/tiles/:z/:x/:y.:format': 'tiles',
  'get /agol/:id/:item/:layer/tiles/:z/:x/:y': 'tiles',
  'get /agol/:id/:item/FeatureServer': 'featureserver',
  'get /agol/:id/:item/FeatureServer/:method': 'featureserver',
  'get /agol/:id/:item/FeatureServer/geohash': 'getGeohash',
  'get /agol/:id/:item/FeatureServer/:layer': 'featureserver',
  'get /agol/:id/:item/FeatureServer/:layer/:method': 'featureserver',
  'post /agol/:id/:item/FeatureServer/:layer/:method': 'featureserver',
  'get /agol/:id/:item/FeatureServer/:layer/geohash': 'getGeohash',
  'get /agol/:id/:item/:layer/expiration': 'getExpiration',
  'put /agol/:id/:item/:layer/expiration': 'setExpiration',
  'post /agol/:id/:item/:layer/expiration': 'setExpiration',
  'get /test': 'testRoute'
}
