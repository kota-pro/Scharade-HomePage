import { fixtureLogin } from "./fixture-auth";
import {test,expect} from '@playwright/test';
const headers={Origin:'http://127.0.0.1:4329'};
test('event choices persist with pastel colors and Monday calendar spans across dates and weeks',async({page},info)=>{
  expect((await fixtureLogin(page.request, '/api/auth/login', {headers,data:{email:'planner@example.invalid',password:'fixture-password-123'}})).ok()).toBe(true);
  await page.goto('/Member/manage/events/new');const category=page.locator('[name="category"]');await expect(category.locator('option')).toHaveText(['撮影会','定例会','その他イベント']);
  const records=[];for(const [index,value]of ['photo','meeting','other'].entries()){
    const response=await page.request.post('/api/member/activities',{headers,data:{action:'event.save',title:`日跨ぎ ${value} ${info.project.name}`,category:value,description:'予定',startsAt:'2027-10-01T09:00:00+09:00',endsAt:index===0?'2027-10-05T00:00:00+09:00':'2027-10-03T18:00:00+09:00',deadline:'2027-09-30T21:00:00+09:00',ownerId:'planner',recipientIds:['planner','member'],meeting:'',itinerary:'',fee:'',theme:''}});expect(response.ok(),await response.text()).toBe(true);const {eventId}=await response.json();
    // Save endpoints return an ID; public views and existing revision checks govern publication.
    const state=await page.request.post('/api/member/activities',{headers,data:{action:'event.publish',eventId,revision:1}});expect(state.ok(),await state.text()).toBe(true);records.push({value,eventId});
  }
  expect((await fixtureLogin(page.request, '/api/auth/login', {headers,data:{email:'member@example.invalid',password:'fixture-password-123'}})).ok()).toBe(true);await page.goto('/Member?view=calendar&month=2027-10');await expect(page.locator('.activity-calendar-head [role="columnheader"]')).toHaveText(['月','火','水','木','金','土','日']);
  const expected={photo:'rgb(248, 221, 232)',meeting:'rgb(230, 240, 203)',other:'rgb(233, 221, 245)'};
  for(const r of records){const bars=page.locator(`.activity-calendar-bar[data-calendar-category="${r.value}"][href="/Member/events/${r.eventId}"]`);await expect(bars.first()).toHaveCSS('background-color',expected[r.value as keyof typeof expected]);if(r.value==='photo'){await expect(bars).toHaveCount(2);await expect(bars.first()).toHaveAttribute('data-calendar-start','1');await expect(bars.first()).toHaveAttribute('data-calendar-end','3');await expect(bars.last()).toHaveAttribute('data-calendar-end','4');const grid=await bars.first().evaluate(e=>getComputedStyle(e).gridColumn);expect(grid).toContain('span 3');}}
  await expect(page.locator('.activity-calendar-bar[data-calendar-category="exhibition"]').first()).toHaveCSS('background-color','rgb(240, 245, 244)');
  await page.screenshot({path:`/private/tmp/exhibition-redesign-20261009/calendar-${info.project.name}.png`,fullPage:true});
});
