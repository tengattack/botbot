
import request from 'request'

const GITHUB_API = 'https://api.github.com'
const USER_AGENT = 'pullscript/0.0.1'

export default class GithubClient {
  constructor(opts) {
    // access_token, etc...
    this.opts = opts || {}
  }
  request(method, uri, params, opts) {
    return new Promise((resolve, reject) => {
      const _opts = {
        method,
        uri: GITHUB_API + uri,
        [method === 'GET' ? 'qs' : 'form']: params,
        ...opts,
        headers: {
          ...(opts && opts.headers),
          'User-Agent': USER_AGENT,
          'Authorization': 'token ' + this.opts.access_token,
        },
        json: true,
        gzip: true,
      }
      if (this.opts.proxy) {
        _opts.proxy = this.opts.proxy
      }
      request(_opts, function (err, resp, body) {
        if (err) {
          return reject(err)
        }
        resolve(body)
      })
    })
  }
  getIssueComments(repo, num, page = 1) {
    return this.request('GET', '/repos/' + repo + '/issues/' + num + '/comments', { page })
  }
}
