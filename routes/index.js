module.exports = {
                               'post /agol/register': 'register',
                                         'get /agol': 'list',
                                     'get /agol/:id': 'find',
                       'get /agol/:id/:item.:format': 'findItemData',
                'get /agol/:id/:item/:layer.:format': 'findItemData',
                 'get /agol/:id/:item/FeatureServer': 'featureserver',
                        'get /agol/:id/:item/:layer': 'findItemData',
                               'get /agol/:id/:item': 'findItem',
                   'get /agol/:id/:item/:layer/drop': 'dropItem',
                   'get /agol/:id/:item/data/:layer': 'findItemData',
                          'get /agol/:id/:item/data': 'findItemData',
  'get /agol/:id/:item/FeatureServer/:layer/:method': 'featureserver',
          'get /agol/:id/:item/FeatureServer/:layer': 'featureserver',
                     'get /agol/:id/:item/thumbnail': 'thumbnail',
              'get /agol/:id/:item/thumbnail/:layer': 'thumbnail',
                                  'delete /agol/:id': 'del',
                       'get /agol/:id/:item/preview': 'preview',
 'get /agol/:id/:item/:layer/tiles/:z/:x/:y.:format': 'tiles',
         'get /agol/:id/:item/:layer/tiles/:z/:x/:y': 'tiles',
        'get /agol/:id/:item/tiles/:z/:x/:y.:format': 'servicetiles',
                'get /agol/:id/:item/tiles/:z/:x/:y': 'servicetiles'
};
