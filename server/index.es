import Koa from 'koa'
import middleware from './middleware'
import controller from './controller'
import config from '../config'

const app = new Koa()
middleware(app)
controller(app)

const { port, hostname } = config['server']
app.listen(port, hostname, () => {
  console.log(`BotBot server listening at ${hostname}:${port}`)
})
