import mysql from 'mysql'
import config from '../config'

const dbconfig = config['db']

class DB {
  constructor() {
    this.connection = mysql.createConnection(dbconfig)
  }
  query(sql, params) {
    return new Promise((resolve, reject) => {
      this.connection.query(sql, params, (err, results) => {
        if (err) {
          return reject(err)
        }
        resolve(results)
      })
    })
  }
  findOne = function (sql, params = []) {
    return new Promise((resolve, reject) => {
      this.connection.query(sql, params, (err, results) => {
        if (err) {
          return reject(err)
        }
        resolve(results[0])
      })
    })
  }
}

const db = new DB()
export default db
