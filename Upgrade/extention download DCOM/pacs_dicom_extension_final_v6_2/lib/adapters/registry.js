'use strict';
import { VietmyAdapter } from './vietmy.js';
import { VradAdapter } from './vrad.js';
import { VrpacsAdapter } from './vrpacs.js';
import { DicomwebAdapter } from './dicomweb.js';
import { GenericAdapter } from './generic.js';
export const adapters=[VietmyAdapter,DicomwebAdapter,VradAdapter,VrpacsAdapter,GenericAdapter];
export function matchingAdapters(summary,state){return adapters.filter(a=>{try{return a.match(summary,state);}catch{return false;}});}
export function adapterById(id){return adapters.find(a=>a.id===id)||null;}
