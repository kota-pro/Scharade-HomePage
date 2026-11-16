import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layoutObjectSizeLabel} from '../src/lib/exhibitionLayoutDimensions.ts';
import {layoutScene} from '../src/lib/exhibitionLayoutScene.ts';
import {layoutObjects} from '../src/lib/exhibitionLayoutModel.ts';
import type {RoomLayout,LayoutWork} from '../src/lib/exhibitionTypes.ts';

test('hover uses actual dimensions for floor markers, rotated shapes, openings and folded board chains',()=>{
 const work:LayoutWork={id:'work',sectionId:'section',kind:'series',title:'組写真 <青>',caption:'',location:'',equipment:'',settings:'',fields:{},photos:[{assetId:'a',x:0,y:0,width:300,height:400,rotation:0},{assetId:'b',x:350,y:0,width:300,height:400,rotation:0}]};
 const room:RoomLayout={id:'room',name:'展示室',vertices:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],wallHeights:[3000,3000,3000,3000],openings:[{id:'door',kind:'door',wall:0,offset:3000,width:900,height:2100,bottom:0}],placements:[{workId:'work',wall:0,x:500,bottom:1000,rotation:0}],tables:[],books:[],annotations:[{id:'shape',kind:'rect',x:1500,y:2000,width:1000,height:600,rotation:45,name:'図形',text:'外側の注記'.repeat(10),fontSize:100}],boardGroups:[{id:'board',name:'展示ボード',x:1000,y:1000,rotation:45,panels:[{id:'p1',name:'1',width:900,height:2000,thickness:30,hingeAngle:0},{id:'p2',name:'2',width:900,height:2400,thickness:30,hingeAngle:90}]}]};
 const before=JSON.stringify(room),objects=layoutObjects(room,[work]);
 assert.equal(objects.find(o=>o.id==='work:work')!.box.width,80);
 assert.equal(layoutObjectSizeLabel(objects.find(o=>o.id==='work:work')!,[work]),'組写真 <青>\n縦 400 × 横 650 mm');
 assert.equal(layoutObjectSizeLabel(objects.find(o=>o.id==='annotation:shape')!,[work]),'図形\n縦 600 × 横 1000 mm');
 assert.match(layoutObjectSizeLabel(objects.find(o=>o.id==='opening:door')!,[work])!,/縦 2100 × 横 900 mm/);
 assert.equal(layoutObjectSizeLabel(objects.find(o=>o.id==='board:board')!,[work]),'展示ボード\n縦 2400 × 横 1800 mm');
 const interactive=layoutScene(room,[work],'floor',{interactive:true,sizes:true}).svg;
 assert.match(interactive,/data-layout-size-label="組写真 &lt;青&gt;\n縦 400 × 横 650 mm"/);
 assert.match(interactive,/data-layout-size-label="壁1\n長さ 6000 mm \/ 高さ 3000 mm"/);
 assert.match(interactive,/data-layout-size-box="460 -40 80 80"/);
 const wall=layoutScene(room,[work],'wall:0',{interactive:true}).svg;
 assert.match(wall,/data-layout-size-box="500 1600 650 400"/);
 const panel=layoutScene(room,[work],'board:board:B',{interactive:true}).svg;
 assert.match(panel,/data-layout-size-label="2\n縦 2400 × 横 900 mm"/);
 const output=layoutScene(room,[work],'floor',{sizes:true}).svg;
 assert.doesNotMatch(output,/data-layout-size-label|data-layout-size-box|data-layout-hover-frame/);
 assert.equal(JSON.stringify(room),before);
});
