const test=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const loader=require('./load-project.cjs');

test('all content/upload images bypass internal optimizer redirects while static assets keep optimization',()=>{
 const load=loader({'next/image':{__esModule:true,default:props=>React.createElement('img',{src:props.src,alt:props.alt,'data-optimized':props.unoptimized?'no':'yes'})}});
 const Image=load('src/components/ContentImage.tsx').default;
 for(const src of ['/uploads/covers/old.jpg','/uploads/supabase/gallery/new.jpg','/uploads/banners/wall.png','https://example.supabase.co/storage/v1/object/public/thd-library/cover.jpg']){
  const html=renderToStaticMarkup(React.createElement(Image,{src,alt:'QA',width:100,height:100,unoptimized:false}));
  assert.match(html,/data-optimized="no"/);assert.ok(html.includes(src));
 }
 assert.match(renderToStaticMarkup(React.createElement(Image,{src:'/logo-thd.png',alt:'School',width:100,height:100})),/data-optimized="yes"/);
});
