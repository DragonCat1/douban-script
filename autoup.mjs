import config from './config'
import request from 'request'
let log = console.log
let douban = {}
douban.comments = []
douban.uplist = ['113173783']
let apis = config.apis
let io = request.defaults({
  headers: config.headers,
  json: true,
  form: config.form,
  timeout: 5000
})
function getSig () {
  let ts = Math.floor((new Date()).getTime() / 1000).toString()
  let sig = Buffer.from((new Date()).getTime().toString()).toString('base64')
  return {'_st': ts, '_sig': sig}
}
function requestPromise (method, url, data) {
  return new Promise(function (resolve, reject) {
    let formData = Object.assign({}, getSig(), config.form, data)
    let requestObj = {
      method: method,
      url: url
    }
    if (method === 'get') requestObj.qs = formData
    else if (method === 'post') requestObj.form = formData
    global.api(
      requestObj
      , function (error, res, body) {
        if (error) reject(error)
        else {
          resolve(body)
        }
      })
  })
}
async function tryRequest (method, url, data) {
  let result
  try {
    result = await requestPromise(method, url, data)
  } catch (e) {
    throw e
  }
  return result
}
async function login () {
  return new Promise(function (resolve, reject) {
    let formData = Object.assign(getSig(), config.form, {'username': config.username, 'password': config.password})
    io.post(apis.login.url, {form: formData}, function (e, r, b) {
      if (e) reject(e)
      else {
        global.douban = Object.assign({}, {access_token: b.access_token, refresh_token: b.refresh_token})
        global.api = io.defaults({
          headers: Object.assign({}, config.headers, {Authorization: `Bearer ${b.access_token}`}),
          baseUrl: 'https://frodo.douban.com/api/v2/',
          jar: true
        })
        resolve(b)
      }
    })
  })
}
async function addComment (topicId, text, commentId) {
  let data = {content: text, comment_id: commentId}
  let result = tryRequest(apis.addComment.method, apis.addComment.url.replace(/\${topicId}/g, topicId), data)
  return result
}
async function delComment (topicId, commentId) {
  let data = {comment_id: commentId}
  let result = tryRequest(apis.delComment.method, apis.delComment.url.replace(/\${topicId}/g, topicId), data)
  return result
}
async function getNotice (num) {
  let data = {count: num}
  let result = tryRequest(apis.getNotice.method, apis.getNotice.url, data)
  return result
}
async function getComments (topicId, start, count) {
  let data = { start: start, count: count }
  let result = await tryRequest(apis.getComments.method, apis.getComments.url.replace(/\${topicId}/g, topicId), data)
  return result.comments
}
async function reply () {
  let notifications = await getNotice(30)
  for (const notice of notifications.notifications) {
    if (!notice.is_read) {
      let topicId
      try {
        topicId = notice.target_uri.match(/topic\/(\d+)\/comments/)[1]
      } catch (err) {
        log(`${notice.text}`)
        return
      }
      let pos = notice.target_uri.match(/pos=(\d+)/)[1]
      let comments = await getComments(topicId, pos, 1)
      let send = await tuling(comments[0].text)
      await addComment(topicId, send, comments[0].id)
      log(`回帖:${comments[0].text} 回复:${send}`)
    }
  }
  setTimeout(reply, 60000)
}
async function autoUp () {
  while (douban.comments.length) {
    await delComment(douban.comments[0].tid, douban.comments[0].cid)
    douban.comments.shift()
    await delay(2000)
  }
  for (let tid of douban.uplist) {
    let cid = (await addComment(tid, `啊噗 ${getTime()}`)).id
    douban.comments.push({tid: tid, cid: cid})
    await delay(10000)
  }
  setTimeout(autoUp, 60000)
  log(getTime(), 'autoUp')
}
function tuling (text) {
  return new Promise(function (resolve, reject) {
    request.post('http://www.tuling123.com/openapi/api', {timeout: 3000, json: true, form: {key: config.tuling, info: text}}, function (e, r, b) {
      if (e) reject(e)
      else {
        let result = b.text
        if (result.match(/暂时无法回答|不知道答案/)) {
          result = `哎呀我忘了要说什么了`
        }
        resolve(result)
      }
    })
  })
}
function delay (time) {
  return new Promise(function (resolve, reject) {
    setTimeout(() => {
      resolve()
    }, time)
  })
}
function getTime () {
  let n = new Date()
  return n.getFullYear() + '/' + (n.getMonth() + 1) + '/' + n.getDate() + ' ' + n.getHours() + ':' + n.getMinutes() + ':' + n.getSeconds() + '.' + n.getMilliseconds()
}
(async function () {
  await login()
  autoUp()
  reply()
})()
