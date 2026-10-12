import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteDB, type IDBPDatabase } from 'idb';
import raw from '../public/sample/store.json';
import { aggregate, costDefaults, filterSales, inventoryAt, makeSale, menuSummaries, parseDataset, periodState, roundWon, saleAmounts, validateDraft, validatePeriod, won, type Dataset, type Draft } from '../src/domain';
import { connect, initialized, load, putSale, removeSale, seed } from '../src/storage';

const data=parseDataset(raw);
const draft:Draft={date:'2026-09-19',menu_id:'M02',channel:'포장',quantity:'12',unit_price:'4800',discount_amount:'2000',food:'1123.2',packaging:'172.8',fee:'800'};
const fixture=()=>({...raw,sales:raw.sales.slice(0,2),inventory_events:raw.inventory_events.slice(0,3),expenses:raw.expenses.slice(0,2)});
let connections:{name:string;db:IDBPDatabase}[]=[];
async function create(){const name=`prep-test-${crypto.randomUUID()}`;const db=await connect(name);connections.push({name,db});await seed(db,fixture());return db;}
afterEach(async()=>{vi.restoreAllMocks();for(const {name,db} of connections){db.close();await deleteDB(name);}connections=[];});

describe('제공 자료·조회와 기본 검증',()=>{
  it('가상 원본의 기록 수와 소수 원가를 보존한다',()=>{expect(data.sales).toHaveLength(6112);expect(data.menus).toHaveLength(8);expect(data.materials).toHaveLength(11);expect(data.sales.at(-1)!.unit_packaging_cost_snapshot).toBe('291.2');});
  it('중복 ID와 판매 집계를 거절한다',()=>{expect(()=>parseDataset({...raw,sales:[raw.sales[0],raw.sales[0]]})).toThrow('중복');expect(()=>parseDataset({...raw,sales:[raw.sales[0],{...raw.sales[0],sale_id:'another'}]})).toThrow('일자·메뉴·채널');});
  it('재료 단위·연결 오류와 가격 적용일 중복을 거절한다',()=>{expect(()=>parseDataset({...raw,recipes:[{...raw.recipes[0],unit:'ml'}]})).toThrow('단위');expect(()=>parseDataset({...raw,price_history:[raw.price_history[0],raw.price_history[0]]})).toThrow('적용일');});
  it('양수 폐기와 0 구매용량을 거절한다',()=>{expect(()=>parseDataset({...raw,inventory_events:[{...raw.inventory_events[0],event_type:'폐기',quantity:1}]})).toThrow('부호');expect(()=>parseDataset({...raw,materials:[{...raw.materials[0],pack_quantity:0}]})).toThrow('형식');});
  it('날짜·순서 오류를 거절하고 기간 양끝을 포함한다',()=>{expect(validatePeriod({start:'2026-02-30',end:'2026-03-01'})).not.toBeNull();expect(validatePeriod({start:'2026-09-20',end:'2026-09-19'})).not.toBeNull();const rows=filterSales(data,{start:'2025-07-01',end:'2025-07-01'});expect(rows.length).toBeGreaterThan(0);expect(rows.every(s=>s.date==='2025-07-01')).toBe(true);});
  it('메뉴·채널 조건으로 조회하며 전체 조건은 6112건이다',()=>{expect(filterSales(data,{start:'2025-07-01',end:'2026-09-18'})).toHaveLength(6112);expect(filterSales(data,{start:'2025-07-01',end:'2026-09-18'},'M02','포장').every(s=>s.menu_id==='M02'&&s.channel==='포장')).toBe(true);});
  it('미마감 12일과 달력 없는 기간을 0 실적으로 확정하지 않는다',()=>{const p=periodState(data,{start:'2026-09-19',end:'2026-09-30'});expect(p.unclosed).toBe(12);expect(p.partial).toBe(true);expect(periodState(data,{start:'2026-10-01',end:'2026-10-01'}).unknown).toBe(1);});
});
describe('판매일 원가·기여이익·반올림',()=>{
  it('9월 라떼 식재료·포장 기본값과 8월 가격 경계를 적용한다',()=>{expect(costDefaults(data,'M02','2026-09-19','포장')).toMatchObject({food:'1123.2',packaging:'166.4',recipeVersion:'R1'});expect(costDefaults(data,'M02','2026-08-31','포장').food).toBe('1081.6');expect(costDefaults(data,'M02','2026-09-19','매장').packaging).toBe('0');});
  it('음료와 디저트 포장세트를 구분한다',()=>{expect(costDefaults(data,'M07','2026-09-19','포장').packaging).toBe('291.2');expect(costDefaults(data,'M07','2026-09-19','매장').packaging).toBe('0');});
  it('가격 없음·중복 적용일·단위 오류는 기본 원가 미확인이다',()=>{expect(costDefaults(data,'M02','2025-06-30','포장').food).toBeNull();const missing={...data,price_history:data.price_history.filter(p=>p.material_id!=='I02')};expect(costDefaults(missing,'M02','2026-09-19','포장').food).toBeNull();const dupe={...data,price_history:[...data.price_history,data.price_history.find(p=>p.material_id==='I02'&&p.effective_date==='2026-09-01')!]};expect(costDefaults(dupe,'M02','2026-09-19','포장').food).toBeNull();});
  it('FRD 예시 55600 / 16352 / 39248 / 70.6을 정확히 계산한다',()=>{const sale=makeSale(data,draft);expect(sale.net_sales).toBe('55600');expect(saleAmounts(sale)).toMatchObject({food:'13478',packaging:'2074',direct:'16352',profit:'39248',rate:'70.6'});});
  it('원가 소수를 보존하고 각 기록 총원가의 0.5원을 올림한다',()=>{expect(roundWon('1.5')).toBe('2');expect(roundWon('1.499')).toBe('1');expect(makeSale(data,draft).unit_food_cost_snapshot).toBe('1123.2');expect(won('10000000000000001')).toBe('10,000,000,000,000,001');});
  it('빈 원가·수수료는 미확인이고 확인된 0은 0이다',()=>{const unknown=makeSale(data,{...draft,fee:''});expect(saleAmounts(unknown).profit).toBeNull();expect(aggregate([unknown,makeSale(data,draft)]).profit).toBeNull();expect(saleAmounts(makeSale(data,{...draft,fee:'0'})).profit).toBe('40048');});
  it('0 순매출의 비율은 계산 불가이며 손실을 보존한다',()=>{const a=saleAmounts(makeSale(data,{...draft,discount_amount:'57600'}));expect(a.rate).toBeNull();expect(a.profit).toBe('-16352');});
  it('이익률 단순 평균 대신 금액 가중 합계를 사용한다',()=>{const a=makeSale(data,{...draft,quantity:'1',unit_price:'100',discount_amount:'0',food:'0',packaging:'0',fee:'0'});const b=makeSale(data,{...draft,quantity:'1',unit_price:'900',discount_amount:'0',food:'900',packaging:'0',fee:'0'});expect(aggregate([a,b]).rate).toBe('10');expect(aggregate([a,b]).averagePrice).toBe('500');});
  it('판매 없는 메뉴도 유지하며 수수료를 개당으로 다시 곱하지 않는다',()=>{const rows=menuSummaries(data,[makeSale(data,draft)]);expect(rows).toHaveLength(8);expect(rows.find(r=>r.menu.menu_id==='M01')!.count).toBe(0);expect(rows.find(r=>r.menu.menu_id==='M02')!.fee).toBe('800');});
});
describe('판매 정정 검증·취소 근거·재료 영향',()=>{
  it('음수·소수 수량·필수 누락·할인 초과·초기일 이전을 거절한다',()=>{for(const patch of [{quantity:'0'},{quantity:'1.2'},{unit_price:''},{food:'-1'},{discount_amount:'60000'},{date:'2025-06-30'}])expect(Object.keys(validateDraft(data,{...draft,...patch})).length).toBeGreaterThan(0);});
  it('수량 정정은 ID·개당 원가·총 수수료를 유지한다',()=>{const original=makeSale(data,draft);const changed=makeSale(data,{...draft,quantity:'10'},original);expect(changed.sale_id).toBe(original.sale_id);expect(changed.payment_fee).toBe('800');expect(changed.unit_food_cost_snapshot).toBe('1123.2');expect(changed.net_sales).toBe('46000');});
  it('추가·정정·삭제 사용량은 원두·우유·포장에 한 번만 반영된다',()=>{const original=inventoryAt(data,'2026-09-19');const sale=makeSale(data,draft);const with12=inventoryAt({...data,sales:[...data.sales,sale]},'2026-09-19');expect(new DecimalValue(original.I01).sub(with12.I01)).toBe('240');expect(new DecimalValue(original.I02).sub(with12.I02)).toBe('2400');expect(new DecimalValue(original.I10).sub(with12.I10)).toBe('12');const with10=inventoryAt({...data,sales:[...data.sales,makeSale(data,{...draft,quantity:'10'},sale)]},'2026-09-19');expect(new DecimalValue(original.I01).sub(with10.I01)).toBe('200');expect(inventoryAt(data,'2026-09-19')).toEqual(original);});
  it('금액 원가를 정정해도 재료 사용량과 실측 원본은 변하지 않는다',()=>{const sale=makeSale(data,draft);const changed=makeSale(data,{...draft,food:'9999'},sale);expect(inventoryAt({...data,sales:[sale]},'2026-09-19')).toEqual(inventoryAt({...data,sales:[changed]},'2026-09-19'));expect(data.inventory_events).toEqual(parseDataset(raw).inventory_events);});
  it('미리보기·취소에는 원본 데이터 변경이 없다',()=>{const before=JSON.stringify(data);makeSale(data,draft);aggregate([makeSale(data,draft)]);expect(JSON.stringify(data)).toBe(before);});
});
// 비교 값만 보조 계산. 실제 구현과 독립적인 정확한 정수 차이 검증.
class DecimalValue{constructor(private value:string){}sub(other:string){return String(BigInt(this.value)-BigInt(other));}}
describe('실제 IndexedDB API 저장·다시 열기·오류 보호',()=>{
  it('샘플을 한 번만 준비한다',async()=>{const db=await create();await seed(db,fixture());const w=await load(db);expect(w.data.sales).toHaveLength(2);expect(w.revision).toBe(0);expect(await initialized(db)).toBe(true);});
  it('추가·정정·삭제가 다시 열기 뒤 유지되며 원본 실측은 보존된다',async()=>{const db=await create();let w=await load(db);const s=makeSale(w.data,draft);await putSale(db,s,w.revision,'add');w=await load(db);expect(w.data.sales).toHaveLength(3);expect(w.revision).toBe(1);await putSale(db,makeSale(w.data,{...draft,quantity:'10'},s),1,'edit');const name=connections[0].name;db.close();const reopened=await connect(name);connections[0].db=reopened;w=await load(reopened);expect(w.data.sales.find(x=>x.sale_id===s.sale_id)?.quantity).toBe(10);await removeSale(reopened,s.sale_id,2);w=await load(reopened);expect(w.data.sales).toHaveLength(2);expect(w.data.inventory_events).toEqual(parseDataset(fixture()).inventory_events);expect(w.revision).toBe(3);});
  it('같은 집계를 새 ID로 다시 추가하지 않는다',async()=>{const db=await create();const sale=makeSale(data,draft);await putSale(db,sale,0,'add');await expect(putSale(db,{...sale,sale_id:crypto.randomUUID()},1,'add')).rejects.toThrow('같은 일자');expect((await load(db)).data.sales).toHaveLength(3);});
  it('연속 저장·다른 탭의 오래된 개정번호를 거절한다',async()=>{const db=await create();const sale=makeSale(data,draft);await putSale(db,sale,0,'add');await expect(putSale(db,sale,0,'add')).rejects.toThrow('변경');await expect(removeSale(db,sale.sale_id,0)).rejects.toThrow('변경');expect((await load(db)).revision).toBe(1);});
  it('삭제할 기록이 없으면 자료와 개정번호를 유지한다',async()=>{const db=await create();await expect(removeSale(db,'missing',0)).rejects.toThrow('없습니다');expect((await load(db)).revision).toBe(0);});
  it('중간 저장 실패는 판매와 개정번호 모두 취소한다',async()=>{const db=await create();const originalPut=IDBObjectStore.prototype.put;const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:any,key?:IDBValidKey){if(this.name==='workspaceMeta')throw new DOMException('quota','QuotaExceededError');return originalPut.call(this,value,key);});await expect(putSale(db,makeSale(data,draft),0,'add')).rejects.toThrow();spy.mockRestore();const w=await load(db);expect(w.data.sales).toHaveLength(2);expect(w.revision).toBe(0);});
  it('손상된 기존 자료와 미지원 버전을 새 샘플로 덮지 않는다',async()=>{const db=await create();const m=await db.get('workspaceMeta','active');await db.put('workspaceMeta',{...m,schemaVersion:99},'active');await expect(load(db)).rejects.toThrow('지원하지 않는');await seed(db,fixture());expect((await db.get('workspaceMeta','active')).schemaVersion).toBe(99);});
});
