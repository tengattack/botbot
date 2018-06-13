import mysql from 'mysql'

export default class DB {
  constructor(config) {
    this.connection = mysql.createConnection(config)
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
  findOne(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.connection.query(sql, params, (err, results) => {
        if (err) {
          return reject(err)
        }
        resolve(results[0])
      })
    })
  }
  close() {
    return new Promise((resolve, reject) => {
      this.connection.end(function (err) {
        if (err) {
          return reject(err)
        }
        resolve()
      })
    })
  }
}

