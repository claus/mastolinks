import os from 'os'
const pool = new Array(os.cpus().length).fill(null)

export default class PromisePool {
  constructor (jobs, handler) {
    this.handler = handler
    this.jobs = jobs
  }

  async done () {
    await Promise.all(pool.map(() => {
      // eslint-disable-next-line no-async-promise-executor
      return new Promise(async (resolve) => {
        while (this.jobs.length) {
          let job
          try {
            job = this.jobs.pop()
            await this.handler(job)
          } catch (err) {
            console.log('Failed: ', job, err)
          }
        }
        resolve()
      })
    }))
  }
}
