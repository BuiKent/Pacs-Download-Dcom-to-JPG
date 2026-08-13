'use strict';
import { VradAdapter } from './vrad.js';
import { VrpacsAdapter } from './vrpacs.js';
import { DicomwebAdapter } from './dicomweb.js';
import { GenericAdapter } from './generic.js';
export const adapters=[DicomwebAdapter,VradAdapter,VrpacsAdapter,GenericAdapter];
export function matchingAdapters(summary,state){return adapters.filter(a=>{try{return a.match(summary,state);}catch{return false;}});}
export function adapterById(id){return adapters.find(a=>a.id===id)||null;}
