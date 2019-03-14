
import CDNClient from './cdn'

const LIVE_CDN_API = 'https://live.aliyuncs.com/'

export default class LiveCDNClient extends CDNClient {
  constructor(conf) {
    super(conf)
    // this.config = conf || config['oss']
    this.api = LIVE_CDN_API
    this.version = '2016-11-01'
  }
  listDomains(pageNumber = 1, pageSize = 20) {
    return this.request({
      Action: 'DescribeLiveUserDomains',
      PageNumber: pageNumber,
      PageSize: pageSize,
    }, true)
  }
  setCertificate(domain, name, pubkey, privkey) {
    return this.request({
      Action: 'SetLiveDomainCertificate',
      DomainName: domain,
      CertName: name,
      SSLProtocol: 'on',
      SSLPub: pubkey,
      SSLPri: privkey,
    })
  }
}
