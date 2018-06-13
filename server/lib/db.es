
import DB from '../../lib/db'
import config from '../config'

const dbconfig = config['db']

const db = new DB(dbconfig)
export default db
