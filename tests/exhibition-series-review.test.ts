import test from 'node:test';
import assert from 'node:assert/strict';
import {seriesReviewModel,seriesReviewHtml,seriesReviewSvg} from '../src/lib/exhibitionSeriesReview.ts';
import type {PhotoLayout,Work} from '../src/lib/exhibitionTypes.ts';
const photo=(x:number,y=0,rotation=0):PhotoLayout=>({assetId:'',x,y,width:120,height:80,rotation});
test('series review measures the nearest horizontal and vertical neighbours and supports changing the reference',()=>{
 const photos=[photo(0),photo(130),photo(0,95)],before=structuredClone(photos),model=seriesReviewModel(photos);
 assert.deepEqual(model.measurements.map(m=>[m.a,m.b,m.axis,m.gap]),[[0,1,'x',10],[0,2,'y',15]]);
 assert.deepEqual(model.gaps.map(g=>[g.index,g.x,g.y]),[[1,10,-80],[2,-120,15]]);
 const fromThird=seriesReviewModel(photos,2);assert.deepEqual(fromThird.gaps.map(g=>[g.index,g.x,g.y]),[[0,-120,15],[1,10,15]]);assert.deepEqual(photos,before);
});
test('rotated photos use their bounding edges for clearances while retaining the original placement anchor',()=>{
 const photos=[photo(0),photo(140,90,90)],model=seriesReviewModel(photos);
 assert.equal(model.measurements.length,1);assert.equal(model.measurements[0].axis,'y');assert.equal(model.measurements[0].gap,10);assert.equal(model.gaps[0].x,-60);assert.equal(model.gaps[0].y,10);
 assert.ok(Math.abs(model.bounds.width-140)<.001);assert.equal(model.bounds.height,210);
 const svg=seriesReviewSvg(photos,id=>id,320);assert.match(svg,/translate\(140 90\) rotate\(90\)/);assert.match(svg,/10\.0 mm/);
});
test('negative placement coordinates, zero spacing and overlapping bounding frames remain measurable',()=>{
 const photos=[photo(-120,-40),photo(0,-40)];const model=seriesReviewModel(photos);assert.equal(model.bounds.x,-120);assert.equal(model.bounds.y,-40);assert.equal(model.measurements[0].gap,0);
 assert.equal(seriesReviewModel([photo(0),photo(100,20)]).gaps[0].x,-20);assert.equal(seriesReviewModel([photo(0),photo(100,20)]).gaps[0].y,-60);
 const svg=seriesReviewSvg(photos,id=>id,240);assert.match(svg,/data-photo-x="-120"/);assert.match(svg,/0\.0 mm/);assert.doesNotMatch(svg,/data-series-review-gap=/);assert.ok(!/NaN|Infinity/.test(svg));
});
test('diagonal clearances are available in the numeric table and sparse layouts have no invented neighbours',()=>{
 const model=seriesReviewModel([photo(0),photo(200,200)]);assert.deepEqual(model.measurements,[]);assert.equal(model.gaps[0].x,80);assert.equal(model.gaps[0].y,120);
 assert.deepEqual(seriesReviewModel([]).gaps,[]);assert.equal(seriesReviewSvg([],id=>id),'');assert.deepEqual(seriesReviewModel([photo(0)]).measurements,[]);assert.deepEqual(seriesReviewModel([photo(0)]).gaps,[]);
});
test('review HTML describes saved mm positions without edit controls or unsafe asset attributes',()=>{
 const work:Work={id:crypto.randomUUID(),sectionId:crypto.randomUUID(),kind:'series',title:'配置',caption:'',location:'',equipment:'',settings:'',fields:{},photos:[{...photo(-10,20,15),assetId:'asset'}]};
 const before=structuredClone(work),html=seriesReviewHtml(work,'submission','draft',()=>'/preview?name="test"&size=1');
 assert.match(html,/data-series-content="draft"/);assert.match(html,/X（mm）/);assert.match(html,/-10\.0/);assert.match(html,/15\.0/);assert.match(html,/&quot;test&quot;&amp;size/);assert.ok(!html.includes('contenteditable'));assert.ok(!html.includes('<input'));assert.ok(!html.includes('data-series-photo='));assert.deepEqual(work,before);
 assert.equal(seriesReviewHtml({...work,kind:'single'},'submission','submitted',id=>id),'');
});
