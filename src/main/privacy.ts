import {redactSource} from './llm';

// Filtering is applied at outbound boundaries. Keep original source privately
// in main so evidence/hash validation and navigation still use actual files.
export function redactText(text:string,credentials:readonly string[]=[]){
  let safe=redactSource(text);
  for(const credential of credentials)if(credential)safe=safe.split(credential).join('[REDACTED]');
  return safe;
}
export function sanitizeOutbound<T>(value:T,credentials:readonly string[]):T{
  if(typeof value==='string')return redactText(value,credentials) as T;
  if(Array.isArray(value))return value.map(item=>sanitizeOutbound(item,credentials)) as T;
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sanitizeOutbound(item,credentials)])) as T;
  return value;
}
