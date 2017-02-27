import url from 'url'
import Router from 'koa-router'
import db from '../../lib/db'
import req from '../../lib/req'
import config from '../../config'

const apiRouter = new Router({ prefix: '/api' })
const buildConfig = config['build']
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
  \`hits\` int(11) UNSIGNED NOT NULL DEFAULT '0',
  \`resource\` tinyint(1) UNSIGNED NOT NULL DEFAULT '0',
  \`resource_path\` varchar(255) NOT NULL,
  PRIMARY KEY (id),
  KEY (utime),
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
INSERT INTO ?? (host, path, ctime, utime, resource, resource_path) VALUES (?, ?, ?, ?, '0', '');
`
const INSERT_RESOURCE_SQL = `
INSERT INTO ?? (host, path, ctime, utime, resource, resource_path) VALUES (?, ?, ?, ?, '1', ?);
`
const UPDATE_RESOURCE_SQL = `
UPDATE ?? SET utime = ?, resource_path = ?, resource = '1' WHERE id = ?;
`
const UPDATE_HITS_SQL = `
UPDATE ?? SET hits = hits + 1 WHERE id = ?;
`
const SELECT_QUEUE_SQL = `
SELECT * FROM ?? WHERE \`resource\` = 0 OR \`utime\` < ? ORDER BY \`hits\` DESC;
`

apiRouter.get('/reset', async function (ctx, next) {
  const r = { code: 200 }
  r.drop = (await db.query(DROP_SQL, [ TABLE_NAME ])) ? true : false
  r.create = (await db.query(RESET_SQL, [ TABLE_NAME ])) ? true : false
  ctx.body = r
})

apiRouter.get('/query', async function (ctx, next) {
  const query = ctx.request.query
  if (!query || !query.url) {
    throw 400
  }
  const q = url.parse(query.url)
  if (!q) {
    throw 400
  }

  let r = await db.findOne(FIND_SQL, [ TABLE_NAME, q.host, q.path ])
  let requestUrl
  if (!r) {
    requestUrl = query.url
    // add queue
    const timestamp = Math.floor(Date.now() / 1000)
    r = await db.query(INSERT_QUEUE_SQL, [ TABLE_NAME, q.host, q.path, timestamp, timestamp ])
  } else {
    requestUrl = OSS_PREFIX + r.resource_path
      // add hits
    r = await db.query(UPDATE_HITS_SQL, [ TABLE_NAME, r.id ])
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
  const q = url.parse(body.url)
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
      TABLE_NAME, q.host, q.path, timestamp, timestamp, resource_path,
    ])
  }
  ctx.body = { code: 200, [optype]: r }
})

apiRouter.get('/queue', async function (ctx, next) {
  const timestamp = Math.floor(Date.now() / 1000)
  const r = await db.query(SELECT_QUEUE_SQL, [ TABLE_NAME, timestamp - CACHE_TIME ])
  ctx.body = { code: 200, list: r }
})

export default apiRouter
