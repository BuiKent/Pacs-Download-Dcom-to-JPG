'use strict';
import { ZfpAdapter } from './zfp.js';
import { VietmyAdapter } from './vietmy.js';
import { VradAdapter } from './vrad.js';
import { VrpacsAdapter } from './vrpacs.js';
import { DicomwebAdapter } from './dicomweb.js';
import { Mach7Adapter } from './mach7.js';
import { GenericAdapter } from './generic.js';
export const adapters=[ZfpAdapter,VietmyAdapter,DicomwebAdapter,VradAdapter,VrpacsAdapter,Mach7Adapter,GenericAdapter];
export function matchingAdapters(summary,state){return adapters.filter(a=>{try{return a.match(summary,state);}catch{return false;}});}
export function adapterById(id){return adapters.find(a=>a.id===id)||null;}
