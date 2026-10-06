// A contextual switch is staged locally; control creation and the selected binding are one write.
import { flattenViews } from '../report-v2.js';
import { CONTROL_LABEL, datasetTypeOf, newNodeId, patchColumn, patchSeries, setControl, setRows, setSliceBy, setX, validateReportDraft } from '../report-draft.js';
import { DIM_KEYS, mintValue } from '../metric-catalog.js';
import { formatForValue, pickViewValue } from './column-format.js';
import { sourceEnv, sourcesFor } from '../spotlight-items.js';

const find = (spec, id) => flattenViews(spec?.views).find((v) => v.id === id);
const controlOf = (spec, type) => spec?.controls?.find((c) => c.type === type);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export function switchSlotInfo(spec, slot) {
  const view = find(spec, slot.viewId);
  if (!view) return null;
  if (['x','rows','sliceBy'].includes(slot.kind)) {
    if ((slot.kind === 'x' && view.kind !== 'chart') || (slot.kind === 'rows' && view.kind !== 'table') || (slot.kind === 'sliceBy' && view.kind !== 'pie')) return null;
    const value = view[slot.kind];
    if (!value || (slot.kind !== 'sliceBy' && !['dim','control'].includes(value.type))) return null;
    return { type:'dimension', view, value, connected:!!value.controlId, key:value.key, grain:value };
  }
  let owner = view;
  if (slot.kind === 'series' && view.kind === 'chart') owner = view.series?.find((x) => x.id === slot.elementId && x.kind === 'value');
  else if (slot.kind === 'column' && view.kind === 'table') owner = view.columns?.find((x) => x.id === slot.elementId && x.kind === 'value');
  else if (!(slot.kind === 'value' && ['kpi','pie'].includes(view.kind))) return null;
  if (!owner?.value) return null;
  return { type:'metric',view,owner,value:owner.value,connected:owner.value.kind === 'bound',grain:view.x || view.rows || (view.kind === 'pie' ? {type:'dim',key:view.sliceBy?.key} : {type:'agg'}) };
}

/** The slot's own value, as a switch OPTION. `metricBy` comes off: an option is one of the
 *  fixed choices the viewer picks between, and the grammar refuses one that follows the buy
 *  unit — which is the value the Standard Breakdown's donut and share hold, and this is the
 *  door those two are meant to reach a switch through. */
function asOption(value) {
  const { metricBy, ...rest } = structuredClone(value);   // eslint-disable-line no-unused-vars
  return rest;
}

function bind(spec, slot, control) {
  const info=switchSlotInfo(spec,slot);
  if (!info) return spec;
  if (info.type === 'dimension') {
    if (slot.kind === 'sliceBy') return setSliceBy(spec,slot.viewId,{controlId:control.id});
    return (slot.kind === 'x' ? setX : setRows)(spec,slot.viewId,{type:'control',controlId:control.id});
  }
  const value={kind:'bound'};
  if (slot.kind === 'column') return patchColumn(spec,slot.viewId,slot.elementId,{value,format:formatForValue(info.owner.format,value,spec,true)});
  if (slot.kind === 'series') return patchSeries(spec,slot.viewId,slot.elementId,{value});
  return pickViewValue(spec,slot.viewId,value,null);
}

export function beginSwitch(widget, slot, env = {}) {
  const info=switchSlotInfo(widget.spec,slot);
  if (!info) return null;
  const existing=controlOf(widget.spec,info.type);
  let draft=widget.spec;
  if (!existing) {
    const optionId=newNodeId(draft,'option');
    draft=setControl(draft,info.type === 'metric'
      ? {type:'metric',label:CONTROL_LABEL.metric,options:[{id:optionId,label:'',labelAuto:true,value:asOption(info.value)}],defaultOptionId:optionId}
      : {type:'dimension',label:CONTROL_LABEL.dimension,options:[info.key],defaultOption:info.key});
  }
  const control=controlOf(draft,info.type);
  return {slot,info,env,existing:!!existing,originalControl:existing,originalValue:structuredClone(info.value),control,draft:bind(draft,slot,control)};
}

/** Probe the actual bound consumer before offering setup. Duplicate metric values are
 * legal; distinct IDs let this ask compatibility without inventing a second reading. */
export function switchActionReason(widget, slot, env = {}) {
  const session=beginSwitch(widget,slot,env);
  if (!session) return 'This slot cannot follow a switch.';
  if (session.existing) return null; // Its preview explains incompatible existing options.
  if (session.info.type === 'metric') {
    const first=session.control.options[0];
    const probe=setControl(session.draft,{type:'metric',options:[first,{...first,id:newNodeId(session.draft,'option')}]});
    return switchCandidate(widget,session,probe).reason;
  }
  const dims=env.dims || DIM_KEYS.map((key)=>({key,available:true}));
  let reason='A dimension switch needs another available dimension.';
  for (const dim of dims) {
    if (!dim.available || dim.key === session.info.key) continue;
    const probe=setControl(session.draft,{type:'dimension',options:[session.info.key,dim.key]});
    const result=switchCandidate(widget,session,probe);
    if (result.ok) return null;
    reason=result.reason;
  }
  return reason;
}

/** Options retain this slot's source. No implicit CM→BQ change or new dataset is made. */
export function addSwitchMetric(spec, session, entry) {
  if (!entry) return null;
  const info=session.info;
  const held=info.value.source;
  const allowed=sourcesFor(entry,{...sourceEnv(session.env),datasetType:datasetTypeOf(spec),anchor:info.view.kind,grain:info.grain,held});
  const source=held ? (allowed.includes(held) ? held : null) : allowed[0];
  if (!source) return null;
  const current=controlOf(spec,'metric');
  const option={id:newNodeId(spec,'option'),label:'',labelAuto:true,value:mintValue(entry,{source,datasetType:datasetTypeOf(spec)})};
  return bind(setControl(spec,{type:'metric',options:[...current.options,option],defaultOptionId:current.defaultOptionId || option.id}),session.slot,current);
}

export function switchCandidate(widget, session, draft = session.draft) {
  const control=controlOf(draft,session.info.type);
  const spec=bind(session.existing ? widget.spec : setControl(widget.spec,control),session.slot,control);
  const checked=validateReportDraft({...widget,spec},session.env);
  return {ok:checked.ok,spec,reason:checked.problems[0]?.detail || null};
}

/** A local list may be incomplete while being edited. Probe its first option with a
 * legal mate, while switchCandidate still keeps Apply disabled until two are authored. */
export function switchOptionReason(widget, session, draft) {
  const control=controlOf(draft,session.info.type);
  if (control.options.length !== 1) return switchCandidate(widget,session,draft).reason;
  if (control.type === 'metric') {
    return switchCandidate(widget,session,setControl(draft,{type:'metric',options:[control.options[0],{...control.options[0],id:newNodeId(draft,'option')}]})).reason;
  }
  const choices=session.env.dims || DIM_KEYS.map((key)=>({key,available:true}));
  let reason='A dimension switch needs another available dimension.';
  for (const choice of choices) {
    if (!choice.available || choice.key === control.options[0]) continue;
    const result=switchCandidate(widget,session,setControl(draft,{type:'dimension',options:[...control.options,choice.key]}));
    if (result.ok) return null;
    reason=result.reason;
  }
  return reason;
}

export function commitSwitch(widget, session) {
  const info=switchSlotInfo(widget.spec,session.slot);
  if (!info || !same(info.value,session.originalValue) || !same(controlOf(widget.spec,session.info.type),session.originalControl)) {
    return {ok:false,spec:widget.spec,reason:'This value or switch changed while the panel was open. Close and open it again.'};
  }
  const result=switchCandidate(widget,session);
  return result.ok ? result : { ...result, spec:widget.spec };
}

/** Explicit presentation conversion only. Canonical binds have different period context,
 * implicit targets and status rules; they must never be rewritten as analytical aliases. */
export function switchableKpiForAtom(atom) {
  const brick=atom?.brick;
  if (atom?.kind !== 'atom' || !['bigStat','kvRow'].includes(brick?.type)) return null;
  const family={int:'count',count1:'count',money:'money',money4:'money',percent:'percent',percent2:'percent',pp:'percent',number2:'number',plain2:'number'}[brick.format];
  if (!family || !brick.bind?.expr || Object.keys(brick.bind).some((k)=>k !== 'expr' && k !== 'chips') || brick.sub) return null;
  if (Object.keys(atom).some((k)=>!['id','kind','brick','span','besideNext'].includes(k))) return null;
  if (Object.keys(brick).some((k)=>!['type','label','bind','target','invert','format','emphasis','sub'].includes(k))) return null;
  if (brick.target && (!brick.target.expr || Object.keys(brick.target).some((k)=>k !== 'expr' && k !== 'chips'))) return null;
  // A chip map (formula chips P0) travels beside its text, after `unitFamily` (spec §3 key order).
  const out={id:atom.id,kind:'kpi',title:brick.label || '',value:{kind:'formula',expr:brick.bind.expr,unitFamily:family,...(brick.bind.chips ? {chips:brick.bind.chips} : {})},format:brick.format,deltaVsOtherSource:false};
  if (brick.target) out.target={value:{kind:'formula',expr:brick.target.expr,unitFamily:family,...(brick.target.chips ? {chips:brick.target.chips} : {})},invert:!!brick.invert};
  for (const key of ['span','besideNext']) if (Object.hasOwn(atom,key)) out[key]=atom[key];
  return out;
}
