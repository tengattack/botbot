import url from 'url'
import Router from 'koa-router'
import db from '../../lib/db'
import req from '../../lib/req'
import config from '../../config'

const apiRouter = new Router({ prefix: '/api' })
const buildConfig = config['build']
const serverConfig = config['server']
const CACHE_TIME = config['cache'].time
const OSS_PREFIX = 'http://' + buildConfig['cdn_host'] + '/'

/* sqls */
const TABLE_NAME = 'static_pages'
const DROP_SQL = `
DROP TABLE IF EXISTS ??;
`
const RESET_SQL = `
CREATE TABLE ?? (
  \`id\` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  \`host\` varchar(255) NOT NULL,
  \`path\` varchar(255) NOT NULL,
  \`ctime\` int(11) UNSIGNED NOT NULL,
  \`utime\` int(11) UNSIGNED NOT NULL,
  \`htime\` int(11) UNSIGNED NOT NULL,
  \`hits\` int(11) UNSIGNED NOT NULL DEFAULT '0',
  \`resource\` tinyint(1) UNSIGNED NOT NULL DEFAULT '0',
  \`resource_path\` varchar(255) NOT NULL,
  PRIMARY KEY (id),
  KEY (utime),
  KEY (htime),
  KEY (host),
  KEY (hits),
  KEY (resource),
  KEY query_path (host, path)
);
`
const FIND_SQL = `
SELECT * FROM ?? WHERE \`host\` = ? AND \`path\` = ? LIMIT 1;
`
const INSERT_QUEUE_SQL = `
INSERT INTO ?? (host, path, ctime, utime, htime, resource, resource_path) VALUES (?, ?, ?, ?, ?, '0', '');
`
const INSERT_RESOURCE_SQL = `
INSERT INTO ?? (host, path, ctime, utime, htime, resource, resource_path) VALUES (?, ?, ?, ?, ?, '1', ?);
`
const UPDATE_RESOURCE_SQL = `
UPDATE ?? SET utime = ?, resource_path = ?, resource = '1' WHERE id = ?;
`
const UPDATE_HITS_SQL = `
UPDATE ?? SET hits = hits + 1, htime = ? WHERE id = ?;
`
const SELECT_QUEUE_SQL = `
SELECT * FROM ?? ORDER BY \`resource\`, \`utime\`, \`hits\` DESC LIMIT 800;
`

function removeDirty(query, params) {
  let dirty = false
  if (params && params.length) {
    for (const k in query) {
      if (!params.includes(k)) {
        delete query[k]
        dirty = true
      }
    }
  } else {
    const dirty_qs = [ '', 't', '_', 'spm', 'id', '_t', '_id' ]
    for (const k of dirty_qs) {
      if (query[k]) {
        delete query[k]
        dirty = true
      }
    }
    for (const k in query) {
      if (!query[k]) {
        delete query[k]
        dirty = true
      }
    }
  }
  return dirty
}

function checkUrlParams(url, query) {
  const urlParams = serverConfig['url_params']
  if (!urlParams) {
    return
  }
  for (const p of urlParams) {
    if (p.test.test(url)) {
      return removeDirty(query, urlParams)
    }
  }
}

function url_parse(_url) {
  const q = url.parse(_url, true)
  const s = q.pathname.split('/')
  if (s.length >= 3 && s[s.length - 1] === '') {
    // remove last slash
    q.pathname = q.pathname.substr(0, q.pathname.length - 1)
  }
  if (checkUrlParams(url, q.query)) {
    q.path = q.pathname + url.format({ query })
  } else {
    q.path = q.pathname
  }
  return q
}

function url_rewrite(url) {
  const urlRewrites = serverConfig['rewrite']
  if (!urlRewrites) {
    return
  }
  for (const rewrite of urlRewrites) {
    if (rewrite.test.test(url)) {
      return url.replace(rewrite.test, rewrite.replacer)
    }
  }
  return
}

apiRouter.get('/reset', async function (ctx, next) {
  const r = { code: 200 }
  r.drop = (await db.query(DROP_SQL, [ TABLE_NAME ])) ? true : false
  r.create = (await db.query(RESET_SQL, [ TABLE_NAME ])) ? true : false
  ctx.body = r
})

apiRouter.get('/query', async function (ctx, next) {
  const qs = ctx.request.querystring
  if (!qs || !qs.startsWith('url=')) {
    throw 400
  }
  const qurl = qs.substr(4)
  const rurl = url_rewrite(qurl)
  if (rurl) {
    ctx.status = 301
    ctx.set('Location', rurl)
    return
  }
  const q = url_parse(qurl)
  if (!q) {
    throw 400
  }

  const timestamp = Math.floor(Date.now() / 1000)
  let r = await db.findOne(FIND_SQL, [ TABLE_NAME, q.host, q.path ])
  let requestUrl
  if (!r) {
    requestUrl = qurl
    // add queue
    r = await db.query(INSERT_QUEUE_SQL, [ TABLE_NAME, q.host, q.path, timestamp, timestamp, timestamp ])
  } else {
    if (parseInt(r.resource)) {
      requestUrl = OSS_PREFIX + r.resource_path
    } else {
      requestUrl = qurl
    }
    // add hits
    r = await db.query(UPDATE_HITS_SQL, [ TABLE_NAME, timestamp, r.id ])
  }
  const body = await req(requestUrl)
  if (body) {
    ctx.body = body
  } else {
    throw 404
  }
})

apiRouter.post('/update', async function (ctx, next) {
  const body = ctx.request.body
  if (!body || !(body.url && body.resource_path)) {
    throw 400
  }
  if (typeof body.url !== 'string'
    || typeof body.resource_path !== 'string') {
    throw 400
  }
  const q = url_parse(body.url)
  if (!q) {
    throw 400
  }
  const resource_path = body.resource_path.trim()
  if (!resource_path) {
    throw 400
  }

  let r = await db.findOne(FIND_SQL, [ TABLE_NAME, q.host, q.path ])
  const timestamp = Math.floor(Date.now() / 1000)
  let optype
  if (r) {
    optype = 'update'
    // exists, update
    r = await db.query(UPDATE_RESOURCE_SQL, [
      TABLE_NAME, timestamp, resource_path, r.id,
    ])
  } else {
    optype = 'insert'
    // not exists, insert
    r = await db.query(INSERT_RESOURCE_SQL, [
      TABLE_NAME, q.host, q.path, timestamp, timestamp, timestamp, resource_path,
    ])
  }
  ctx.body = { code: 200, [optype]: r }
})

apiRouter.get('/queue', async function (ctx, next) {
  const timestamp = Math.floor(Date.now() / 1000)
  // , timestamp - CACHE_TIME
  const r = await db.query(SELECT_QUEUE_SQL, [ TABLE_NAME ])
  ctx.body = { code: 200, list: r }
})

export default apiRouter
