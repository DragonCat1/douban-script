import request from 'request'
import config from './config'

const { log } = console
const douban = {}
douban.comments = []
douban.uplist = ['120964029', '121043085', '121043094', '121043098', '121043117']
const { apis } = config
let Client = request.defaults({
  headers: config.headers,
  json: true,
  form: config.form,
  timeout: 5000
})

function delay(time) {
  return new Promise(((resolve) => {
    setTimeout(() => {
      resolve()
    }, time)
  }))
}

function getTime() {
  const n = new Date()
  return `${n.getFullYear()}/${n.getMonth() + 1}/${n.getDate()} ${n.getHours()}:${n.getMinutes()}:${n.getSeconds()}.${n.getMilliseconds()}`
}

function getSig() {
  const ts = Math.floor((new Date()).getTime() / 1000).toString()
  const sig = Buffer.from((new Date()).getTime().toString()).toString('base64')
  return { _st: ts, _sig: sig }
}

function tuling(text) {
  return new Promise(((resolve, reject) => {
    request.post('http://www.tuling123.com/openapi/api', { timeout: 3000, json: true, form: { key: config.tuling, info: text } }, (e, r, b) => {
      if (e) reject(e)
      else {
        let result = b.text
        if (result.match(/暂时无法回答|不知道答案/)) {
          result = '哎呀我忘了要说什么了'
        }
        resolve(result)
      }
    })
  }))
}

function requestPromise(method, url, data) {
  return new Promise(((resolve, reject) => {
    const formData = Object.assign({}, getSig(), config.form, data)
    const requestObj = {
      method,
      url
    }
    if (method === 'get') requestObj.qs = formData
    else if (method === 'post') requestObj.form = formData
    Client(
      requestObj,
      (error, res, body) => {
        if (error) reject(error)
        else {
          resolve(body)
        }
      }
    )
  }))
}

async function tryRequest(method, url, data) {
  let result
  try {
    result = await requestPromise(method, url, data)
  } catch (e) {
    throw e
  }
  return result
}

async function login() {
  return new Promise(((resolve, reject) => {
    const formData = Object.assign(getSig(), config.form, { username: config.username, password: config.password })
    Client.post(apis.login.url, { form: formData }, (e, r, b) => {
      if (e) reject(e)
      else {
        Client = Client.defaults({
          headers: Object.assign({}, config.headers, { Authorization: `Bearer ${b.access_token}` }),
          baseUrl: 'https://frodo.douban.com/api/v2/',
          jar: true
        })
        resolve(b)
        log('登陆信息：', b)
      }
    })
  }))
}

async function addComment(topicId, text, commentId) {
  const data = { content: text, comment_id: commentId }
  const result = tryRequest(apis.addComment.method, apis.addComment.url.replace(/\${topicId}/g, topicId), data)
  return result
}

async function delComment(topicId, commentId) {
  const data = { comment_id: commentId }
  const result = tryRequest(apis.delComment.method, apis.delComment.url.replace(/\${topicId}/g, topicId), data)
  return result
}

async function getNotice(num) {
  const data = { count: num }
  const result = tryRequest(apis.getNotice.method, apis.getNotice.url, data)
  return result
}

async function getComments(topicId, start, count) {
  const data = { start, count }
  const result = await tryRequest(apis.getComments.method, apis.getComments.url.replace(/\${topicId}/g, topicId), data)
  return result.comments
}

async function reply() {
  const notifications = await getNotice(30)
  for (const notice of notifications.notifications) {
    if (!notice.is_read) {
      let topicId
      try {
        topicId = notice.target_uri.match(/topic\/(\d+)\/comments/)[1]
      } catch (err) {
        log(`${notice.text}`)
        return
      }
      const pos = notice.target_uri.match(/pos=(\d+)/)[1]
      const comments = await getComments(topicId, pos, 1)
      const send = await tuling(comments[0].text)
      await addComment(topicId, send, comments[0].id)
      log(`回帖:${comments[0].text} 回复:${send}`)
    }
  }
  setTimeout(reply, 60000)
}

async function autoUp() {
  log('-----AutoUp-----')
  for (const tid of douban.uplist) {
    if (douban.comments.length === douban.uplist.length) {
      try {
        await delComment(douban.comments[0].tid, douban.comments[0].cid)
        douban.comments.shift()
      } catch (err) {
        log('删除出错：', err)
      }
      await delay(2000)
    }
    try {
      const addComRes = await addComment(tid, `Up ${getTime()}`)
      const cid = addComRes.id
      log(getTime(), `Up：${tid}:${cid}`)
      douban.comments.push({ tid, cid })
    } catch (err) {
      log('回复出错：', err)
    }
    await delay(60000)
  }
  setTimeout(autoUp, 600000)
}

(async function () {
  await login()
  autoUp()
  reply()
}())
