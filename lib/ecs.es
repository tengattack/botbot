
import CDNClient from './cdn'
import config from '../config'

const ECS_API = 'https://ecs.aliyuncs.com/'

export default class ECSClient extends CDNClient {
  constructor(conf) {
    super(conf)
    this.config = { ...this.config, ...config['ecs'] }
    this.api = ECS_API
    this.version = '2014-05-26'
  }
  getInstances(instance_ids, page = 1, page_size = 30) {
    return this.request({
      Action: 'DescribeInstances',
      RegionId: this.config.regionId,
      InstanceIds: JSON.stringify(instance_ids),
      PageNumber: page,
      PageSize: page_size,
    })
  }
}
