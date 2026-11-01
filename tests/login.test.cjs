const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest, NextResponse } = require('next/server');
const loader = require('./load-project.cjs');

test('login origin uses Host for LAN and preserves strict CSRF checks', () => {
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://library.example';
  try {
    const { sameOriginAllowed, requestOrigin } = loader()('src/lib/backend-utils.ts');
    const request = (origin, extra = {}) => new Request('http://localhost:3000/api/admin/login', {
      method: 'POST', headers: { host: '192.168.0.106:3000', origin, ...extra },
    });
    assert.equal(requestOrigin(request('http://192.168.0.106:3000')), 'http://192.168.0.106:3000');
    assert.equal(sameOriginAllowed(request('http://192.168.0.106:3000')), true);
    assert.equal(sameOriginAllowed(request('http://localhost:3000')), false);
    assert.equal(sameOriginAllowed(request('http://192.168.0.106:3001')), false);
    assert.equal(sameOriginAllowed(request('https://192.168.0.106:3000')), false);
    assert.equal(sameOriginAllowed(request('null')), false);
    assert.equal(sameOriginAllowed(request('https://untrusted.example')), false);
    assert.equal(sameOriginAllowed(request('http://192.168.0.106:3000', {'sec-fetch-site': 'cross-site'})), false);
    assert.equal(sameOriginAllowed(request('https://untrusted.example', {'x-forwarded-host': 'untrusted.example', 'x-forwarded-proto': 'https'})), false);
    const proxied = request('https://library.example', {host:'app:3000', 'x-forwarded-host':'library.example', 'x-forwarded-proto':'https'});
    assert.equal(requestOrigin(proxied), 'https://library.example');
    assert.equal(sameOriginAllowed(proxied), true);
    const local = request('http://localhost:3000', {host:'localhost:3000'});
    assert.equal(sameOriginAllowed(local), true);
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  }
});

test('production HTTP LAN cookie is usable while HTTPS cookie stays Secure and HttpOnly', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const auth = loader({'@/lib/db': {}})('src/lib/admin-auth.ts');
    for (const origin of ['http://localhost:3000', 'http://192.168.0.106:3000', 'https://library.example']) {
      const response = NextResponse.json({});
      auth.setAdminCookie(response, 'test-session-token', origin);
      const cookie = response.cookies.get(auth.ADMIN_COOKIE_NAME);
      assert.equal(cookie.httpOnly, true);
      assert.equal(cookie.sameSite, 'lax');
      assert.equal(cookie.secure, origin.startsWith('https:'));
      const cleared = NextResponse.json({});
      auth.clearAdminCookie(cleared, origin);
      assert.equal(cleared.cookies.get(auth.ADMIN_COOKIE_NAME).secure, cookie.secure);
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('visitor cookie also persists on HTTP LAN in production', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const utils = loader()('src/lib/backend-utils.ts');
    const request = new NextRequest('http://localhost:3000/api/library/19/like', {headers:{host:'192.168.0.106:3000'}});
    const response = NextResponse.json({});
    utils.ensureVisitorId(request,response);
    const cookie = response.cookies.get(utils.VISITOR_COOKIE);
    assert.equal(cookie.httpOnly,true);
    assert.equal(cookie.secure,false);
    const https = new NextRequest('https://library.example/api/library/19/like');
    const secureResponse = NextResponse.json({});
    utils.ensureVisitorId(https,secureResponse);
    assert.equal(secureResponse.cookies.get(utils.VISITOR_COOKIE).secure,true);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('HTML and JSON login both create session with correct origin and credentials', async () => {
  const saved = {user:process.env.ADMIN_USERNAME, password:process.env.ADMIN_PASSWORD, origin:process.env.APP_ORIGIN};
  process.env.ADMIN_USERNAME = 'test-admin';
  process.env.ADMIN_PASSWORD = 'test-password';
  process.env.APP_ORIGIN = 'https://library.example';
  const sessions = [];
  const auth = {
    createAdminSession: async input => { sessions.push(input); return 'test-token'; },
    setAdminCookie: (response, token, origin) => response.cookies.set({name:'thd_admin_session',value:token,httpOnly:true,sameSite:'lax',secure:origin.startsWith('https:'),path:'/'}),
  };
  const database = {ensureSchema:async()=>{},db:{connect:async()=>({query:async()=>({rows:[{count:0}]}),release:()=>{}})}};
  try {
    const { POST } = loader({'@/lib/admin-auth':auth,'@/lib/db':database})('src/app/api/admin/login/route.ts');
    for (const json of [false, true]) {
      const fields = {username:'test-admin',password:'test-password'};
      const response = await POST(new NextRequest('http://localhost:3000/api/admin/login', {
        method:'POST', headers:{host:'192.168.0.106:3000',origin:'http://192.168.0.106:3000','content-type':json?'application/json':'application/x-www-form-urlencoded'},
        body:json?JSON.stringify(fields):new URLSearchParams(fields).toString(),
      }));
      assert.equal(response.status, json?200:303);
      if (!json) assert.equal(response.headers.get('location'),'http://192.168.0.106:3000/admin');
      assert.equal(response.cookies.get('thd_admin_session').httpOnly,true);
      assert.equal(response.cookies.get('thd_admin_session').secure,false);
    }
    assert.equal(sessions.length,2);
    assert.ok(sessions.every(input=>input.username==='test-admin'));
  } finally {
    for (const [key,value] of [['ADMIN_USERNAME',saved.user],['ADMIN_PASSWORD',saved.password],['APP_ORIGIN',saved.origin]]) {
      if (value === undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});
