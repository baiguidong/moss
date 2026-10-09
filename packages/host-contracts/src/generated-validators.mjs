import runtime0 from 'ajv/dist/runtime/ucs2length.js'
"use strict";
export const v0 = validate10;
const schema11 = {"type":"object","properties":{"idempotencyKey":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"title":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"route":{"type":"string","minLength":1,"maxLength":1024,"pattern":"^#/[a-zA-Z0-9/_?=&.%+-]*$"},"limits":{"type":"object","properties":{"maxConcurrency":{"type":"integer","minimum":1,"maximum":16},"maxCalls":{"type":"integer","minimum":1,"maximum":256},"maxDurationMs":{"type":"integer","minimum":1,"maximum":1800000},"maxTokens":{"type":"integer","minimum":1,"maximum":2000000}},"required":[],"additionalProperties":false}},"required":["idempotencyKey","title"],"additionalProperties":false};
const func2 = (runtime0.default || runtime0);
const pattern0 = new RegExp("^(?=[\\s\\S]*\\S)[^\\u0000]*$", "u");
const pattern2 = new RegExp("^#/[a-zA-Z0-9/_?=&.%+-]*$", "u");

function validate10(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.idempotencyKey === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "idempotencyKey"},message:"must have required property '"+"idempotencyKey"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.title === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "idempotencyKey") || (key0 === "title")) || (key0 === "route")) || (key0 === "limits"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.idempotencyKey !== undefined){
let data0 = data.idempotencyKey;
if(typeof data0 === "string"){
if(func2(data0) > 512){
const err3 = {instancePath:instancePath+"/idempotencyKey",schemaPath:"#/properties/idempotencyKey/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/idempotencyKey",schemaPath:"#/properties/idempotencyKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern0.test(data0)){
const err5 = {instancePath:instancePath+"/idempotencyKey",schemaPath:"#/properties/idempotencyKey/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/idempotencyKey",schemaPath:"#/properties/idempotencyKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.title !== undefined){
let data1 = data.title;
if(typeof data1 === "string"){
if(func2(data1) > 512){
const err7 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data1) < 1){
const err8 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern0.test(data1)){
const err9 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.route !== undefined){
let data2 = data.route;
if(typeof data2 === "string"){
if(func2(data2) > 1024){
const err11 = {instancePath:instancePath+"/route",schemaPath:"#/properties/route/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func2(data2) < 1){
const err12 = {instancePath:instancePath+"/route",schemaPath:"#/properties/route/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(!pattern2.test(data2)){
const err13 = {instancePath:instancePath+"/route",schemaPath:"#/properties/route/pattern",keyword:"pattern",params:{pattern: "^#/[a-zA-Z0-9/_?=&.%+-]*$"},message:"must match pattern \""+"^#/[a-zA-Z0-9/_?=&.%+-]*$"+"\""};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/route",schemaPath:"#/properties/route/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.limits !== undefined){
let data3 = data.limits;
if(data3 && typeof data3 == "object" && !Array.isArray(data3)){
for(const key1 in data3){
if(!((((key1 === "maxConcurrency") || (key1 === "maxCalls")) || (key1 === "maxDurationMs")) || (key1 === "maxTokens"))){
const err15 = {instancePath:instancePath+"/limits",schemaPath:"#/properties/limits/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data3.maxConcurrency !== undefined){
let data4 = data3.maxConcurrency;
if(!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))){
const err16 = {instancePath:instancePath+"/limits/maxConcurrency",schemaPath:"#/properties/limits/properties/maxConcurrency/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(typeof data4 == "number"){
if(data4 > 16 || isNaN(data4)){
const err17 = {instancePath:instancePath+"/limits/maxConcurrency",schemaPath:"#/properties/limits/properties/maxConcurrency/maximum",keyword:"maximum",params:{comparison: "<=", limit: 16},message:"must be <= 16"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(data4 < 1 || isNaN(data4)){
const err18 = {instancePath:instancePath+"/limits/maxConcurrency",schemaPath:"#/properties/limits/properties/maxConcurrency/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
if(data3.maxCalls !== undefined){
let data5 = data3.maxCalls;
if(!((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5)))){
const err19 = {instancePath:instancePath+"/limits/maxCalls",schemaPath:"#/properties/limits/properties/maxCalls/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(typeof data5 == "number"){
if(data5 > 256 || isNaN(data5)){
const err20 = {instancePath:instancePath+"/limits/maxCalls",schemaPath:"#/properties/limits/properties/maxCalls/maximum",keyword:"maximum",params:{comparison: "<=", limit: 256},message:"must be <= 256"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data5 < 1 || isNaN(data5)){
const err21 = {instancePath:instancePath+"/limits/maxCalls",schemaPath:"#/properties/limits/properties/maxCalls/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
if(data3.maxDurationMs !== undefined){
let data6 = data3.maxDurationMs;
if(!((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6)))){
const err22 = {instancePath:instancePath+"/limits/maxDurationMs",schemaPath:"#/properties/limits/properties/maxDurationMs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(typeof data6 == "number"){
if(data6 > 1800000 || isNaN(data6)){
const err23 = {instancePath:instancePath+"/limits/maxDurationMs",schemaPath:"#/properties/limits/properties/maxDurationMs/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1800000},message:"must be <= 1800000"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data6 < 1 || isNaN(data6)){
const err24 = {instancePath:instancePath+"/limits/maxDurationMs",schemaPath:"#/properties/limits/properties/maxDurationMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
if(data3.maxTokens !== undefined){
let data7 = data3.maxTokens;
if(!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))){
const err25 = {instancePath:instancePath+"/limits/maxTokens",schemaPath:"#/properties/limits/properties/maxTokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(typeof data7 == "number"){
if(data7 > 2000000 || isNaN(data7)){
const err26 = {instancePath:instancePath+"/limits/maxTokens",schemaPath:"#/properties/limits/properties/maxTokens/maximum",keyword:"maximum",params:{comparison: "<=", limit: 2000000},message:"must be <= 2000000"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(data7 < 1 || isNaN(data7)){
const err27 = {instancePath:instancePath+"/limits/maxTokens",schemaPath:"#/properties/limits/properties/maxTokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
}
}
else {
const err28 = {instancePath:instancePath+"/limits",schemaPath:"#/properties/limits/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
}
else {
const err29 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
validate10.errors = vErrors;
return errors === 0;
}

export const v1 = validate11;
const schema12 = {"type":"object","properties":{"id":{"type":"string","minLength":1},"appId":{"type":"string","minLength":1},"instanceId":{"type":"string","minLength":1},"title":{"type":"string","minLength":1},"route":{"type":"string","minLength":1},"status":{"enum":["running","completed","failed","cancelled","interrupted"]},"revision":{"type":"integer","minimum":1},"scopeRef":{"type":"string","minLength":1},"attempt":{"type":"integer","minimum":1},"limits":{"type":"object","properties":{"maxConcurrency":{"type":"integer","minimum":1},"maxCalls":{"type":"integer","minimum":1},"maxDurationMs":{"type":"integer","minimum":1},"maxTokens":{"type":"integer","minimum":1}},"required":["maxConcurrency","maxCalls","maxDurationMs","maxTokens"],"additionalProperties":false},"createdAt":{"type":"integer","minimum":1},"updatedAt":{"type":"integer","minimum":1},"deadlineAt":{"type":"integer","minimum":1},"sessionId":{"type":"string","minLength":1},"workspace":{"type":"string"},"executionCount":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"summary":{"type":"string"},"progress":{"type":"number","minimum":0,"maximum":1},"result":{},"error":{"type":"string"}},"required":["id","appId","instanceId","title","route","status","revision","scopeRef","attempt","limits","createdAt","updatedAt","deadlineAt","sessionId","executionCount","tokens"],"additionalProperties":false};
const func8 = Object.prototype.hasOwnProperty;

function validate11(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.appId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "appId"},message:"must have required property '"+"appId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.instanceId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "instanceId"},message:"must have required property '"+"instanceId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.title === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.route === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "route"},message:"must have required property '"+"route"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.status === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.revision === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.scopeRef === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "scopeRef"},message:"must have required property '"+"scopeRef"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.attempt === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "attempt"},message:"must have required property '"+"attempt"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.limits === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "limits"},message:"must have required property '"+"limits"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.createdAt === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.updatedAt === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "updatedAt"},message:"must have required property '"+"updatedAt"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data.deadlineAt === undefined){
const err12 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "deadlineAt"},message:"must have required property '"+"deadlineAt"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data.sessionId === undefined){
const err13 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sessionId"},message:"must have required property '"+"sessionId"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data.executionCount === undefined){
const err14 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "executionCount"},message:"must have required property '"+"executionCount"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data.tokens === undefined){
const err15 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tokens"},message:"must have required property '"+"tokens"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
for(const key0 in data){
if(!(func8.call(schema12.properties, key0))){
const err16 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(typeof data0 === "string"){
if(func2(data0) < 1){
const err17 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.appId !== undefined){
let data1 = data.appId;
if(typeof data1 === "string"){
if(func2(data1) < 1){
const err19 = {instancePath:instancePath+"/appId",schemaPath:"#/properties/appId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
else {
const err20 = {instancePath:instancePath+"/appId",schemaPath:"#/properties/appId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.instanceId !== undefined){
let data2 = data.instanceId;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err21 = {instancePath:instancePath+"/instanceId",schemaPath:"#/properties/instanceId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
else {
const err22 = {instancePath:instancePath+"/instanceId",schemaPath:"#/properties/instanceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.title !== undefined){
let data3 = data.title;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err23 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.route !== undefined){
let data4 = data.route;
if(typeof data4 === "string"){
if(func2(data4) < 1){
const err25 = {instancePath:instancePath+"/route",schemaPath:"#/properties/route/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/route",schemaPath:"#/properties/route/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.status !== undefined){
let data5 = data.status;
if(!(((((data5 === "running") || (data5 === "completed")) || (data5 === "failed")) || (data5 === "cancelled")) || (data5 === "interrupted"))){
const err27 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema12.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data.revision !== undefined){
let data6 = data.revision;
if(!((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6)))){
const err28 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(typeof data6 == "number"){
if(data6 < 1 || isNaN(data6)){
const err29 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
if(data.scopeRef !== undefined){
let data7 = data.scopeRef;
if(typeof data7 === "string"){
if(func2(data7) < 1){
const err30 = {instancePath:instancePath+"/scopeRef",schemaPath:"#/properties/scopeRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
else {
const err31 = {instancePath:instancePath+"/scopeRef",schemaPath:"#/properties/scopeRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data.attempt !== undefined){
let data8 = data.attempt;
if(!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))){
const err32 = {instancePath:instancePath+"/attempt",schemaPath:"#/properties/attempt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(typeof data8 == "number"){
if(data8 < 1 || isNaN(data8)){
const err33 = {instancePath:instancePath+"/attempt",schemaPath:"#/properties/attempt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
if(data.limits !== undefined){
let data9 = data.limits;
if(data9 && typeof data9 == "object" && !Array.isArray(data9)){
if(data9.maxConcurrency === undefined){
const err34 = {instancePath:instancePath+"/limits",schemaPath:"#/properties/limits/required",keyword:"required",params:{missingProperty: "maxConcurrency"},message:"must have required property '"+"maxConcurrency"+"'"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data9.maxCalls === undefined){
const err35 = {instancePath:instancePath+"/limits",schemaPath:"#/properties/limits/required",keyword:"required",params:{missingProperty: "maxCalls"},message:"must have required property '"+"maxCalls"+"'"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(data9.maxDurationMs === undefined){
const err36 = {instancePath:instancePath+"/limits",schemaPath:"#/properties/limits/required",keyword:"required",params:{missingProperty: "maxDurationMs"},message:"must have required property '"+"maxDurationMs"+"'"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(data9.maxTokens === undefined){
const err37 = {instancePath:instancePath+"/limits",schemaPath:"#/properties/limits/required",keyword:"required",params:{missingProperty: "maxTokens"},message:"must have required property '"+"maxTokens"+"'"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
for(const key1 in data9){
if(!((((key1 === "maxConcurrency") || (key1 === "maxCalls")) || (key1 === "maxDurationMs")) || (key1 === "maxTokens"))){
const err38 = {instancePath:instancePath+"/limits",schemaPath:"#/properties/limits/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
if(data9.maxConcurrency !== undefined){
let data10 = data9.maxConcurrency;
if(!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))){
const err39 = {instancePath:instancePath+"/limits/maxConcurrency",schemaPath:"#/properties/limits/properties/maxConcurrency/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(typeof data10 == "number"){
if(data10 < 1 || isNaN(data10)){
const err40 = {instancePath:instancePath+"/limits/maxConcurrency",schemaPath:"#/properties/limits/properties/maxConcurrency/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
}
if(data9.maxCalls !== undefined){
let data11 = data9.maxCalls;
if(!((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11)))){
const err41 = {instancePath:instancePath+"/limits/maxCalls",schemaPath:"#/properties/limits/properties/maxCalls/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
if(typeof data11 == "number"){
if(data11 < 1 || isNaN(data11)){
const err42 = {instancePath:instancePath+"/limits/maxCalls",schemaPath:"#/properties/limits/properties/maxCalls/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
}
if(data9.maxDurationMs !== undefined){
let data12 = data9.maxDurationMs;
if(!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))){
const err43 = {instancePath:instancePath+"/limits/maxDurationMs",schemaPath:"#/properties/limits/properties/maxDurationMs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if(typeof data12 == "number"){
if(data12 < 1 || isNaN(data12)){
const err44 = {instancePath:instancePath+"/limits/maxDurationMs",schemaPath:"#/properties/limits/properties/maxDurationMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
}
if(data9.maxTokens !== undefined){
let data13 = data9.maxTokens;
if(!((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13)))){
const err45 = {instancePath:instancePath+"/limits/maxTokens",schemaPath:"#/properties/limits/properties/maxTokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if(typeof data13 == "number"){
if(data13 < 1 || isNaN(data13)){
const err46 = {instancePath:instancePath+"/limits/maxTokens",schemaPath:"#/properties/limits/properties/maxTokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
}
}
else {
const err47 = {instancePath:instancePath+"/limits",schemaPath:"#/properties/limits/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
if(data.createdAt !== undefined){
let data14 = data.createdAt;
if(!((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14)))){
const err48 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
if(typeof data14 == "number"){
if(data14 < 1 || isNaN(data14)){
const err49 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
}
if(data.updatedAt !== undefined){
let data15 = data.updatedAt;
if(!((typeof data15 == "number") && (!(data15 % 1) && !isNaN(data15)))){
const err50 = {instancePath:instancePath+"/updatedAt",schemaPath:"#/properties/updatedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
if(typeof data15 == "number"){
if(data15 < 1 || isNaN(data15)){
const err51 = {instancePath:instancePath+"/updatedAt",schemaPath:"#/properties/updatedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
}
if(data.deadlineAt !== undefined){
let data16 = data.deadlineAt;
if(!((typeof data16 == "number") && (!(data16 % 1) && !isNaN(data16)))){
const err52 = {instancePath:instancePath+"/deadlineAt",schemaPath:"#/properties/deadlineAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
if(typeof data16 == "number"){
if(data16 < 1 || isNaN(data16)){
const err53 = {instancePath:instancePath+"/deadlineAt",schemaPath:"#/properties/deadlineAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
}
if(data.sessionId !== undefined){
let data17 = data.sessionId;
if(typeof data17 === "string"){
if(func2(data17) < 1){
const err54 = {instancePath:instancePath+"/sessionId",schemaPath:"#/properties/sessionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
else {
const err55 = {instancePath:instancePath+"/sessionId",schemaPath:"#/properties/sessionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
if(data.workspace !== undefined){
if(typeof data.workspace !== "string"){
const err56 = {instancePath:instancePath+"/workspace",schemaPath:"#/properties/workspace/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
}
if(data.executionCount !== undefined){
let data19 = data.executionCount;
if(!((typeof data19 == "number") && (!(data19 % 1) && !isNaN(data19)))){
const err57 = {instancePath:instancePath+"/executionCount",schemaPath:"#/properties/executionCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
if(typeof data19 == "number"){
if(data19 < 0 || isNaN(data19)){
const err58 = {instancePath:instancePath+"/executionCount",schemaPath:"#/properties/executionCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
}
}
if(data.tokens !== undefined){
let data20 = data.tokens;
if(!((typeof data20 == "number") && (!(data20 % 1) && !isNaN(data20)))){
const err59 = {instancePath:instancePath+"/tokens",schemaPath:"#/properties/tokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
if(typeof data20 == "number"){
if(data20 < 0 || isNaN(data20)){
const err60 = {instancePath:instancePath+"/tokens",schemaPath:"#/properties/tokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
}
}
if(data.summary !== undefined){
if(typeof data.summary !== "string"){
const err61 = {instancePath:instancePath+"/summary",schemaPath:"#/properties/summary/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
}
if(data.progress !== undefined){
let data22 = data.progress;
if(typeof data22 == "number"){
if(data22 > 1 || isNaN(data22)){
const err62 = {instancePath:instancePath+"/progress",schemaPath:"#/properties/progress/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
if(data22 < 0 || isNaN(data22)){
const err63 = {instancePath:instancePath+"/progress",schemaPath:"#/properties/progress/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
}
else {
const err64 = {instancePath:instancePath+"/progress",schemaPath:"#/properties/progress/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
}
if(data.error !== undefined){
if(typeof data.error !== "string"){
const err65 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
}
}
else {
const err66 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
validate11.errors = vErrors;
return errors === 0;
}

export const v2 = validate12;
const schema13 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"}},"required":["taskId"],"additionalProperties":false};

function validate12(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.taskId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "taskId"},message:"must have required property '"+"taskId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "taskId")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.taskId !== undefined){
let data0 = data.taskId;
if(typeof data0 === "string"){
if(func2(data0) > 512){
const err2 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern0.test(data0)){
const err4 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate12.errors = vErrors;
return errors === 0;
}

export const v3 = validate13;
const schema14 = {"type":"object","properties":{"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":10}},"required":[],"additionalProperties":false};

function validate13(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!((key0 === "offset") || (key0 === "limit"))){
const err0 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
if(data.offset !== undefined){
let data0 = data.offset;
if(!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))){
const err1 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(typeof data0 == "number"){
if(data0 < 0 || isNaN(data0)){
const err2 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
}
if(data.limit !== undefined){
let data1 = data.limit;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err3 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 > 10 || isNaN(data1)){
const err4 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 10},message:"must be <= 10"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1 < 1 || isNaN(data1)){
const err5 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate13.errors = vErrors;
return errors === 0;
}

export const v4 = validate14;
const schema15 = {"type":"object","properties":{"tasks":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1},"appId":{"type":"string","minLength":1},"instanceId":{"type":"string","minLength":1},"title":{"type":"string","minLength":1},"route":{"type":"string","minLength":1},"status":{"enum":["running","completed","failed","cancelled","interrupted"]},"revision":{"type":"integer","minimum":1},"scopeRef":{"type":"string","minLength":1},"attempt":{"type":"integer","minimum":1},"limits":{"type":"object","properties":{"maxConcurrency":{"type":"integer","minimum":1},"maxCalls":{"type":"integer","minimum":1},"maxDurationMs":{"type":"integer","minimum":1},"maxTokens":{"type":"integer","minimum":1}},"required":["maxConcurrency","maxCalls","maxDurationMs","maxTokens"],"additionalProperties":false},"createdAt":{"type":"integer","minimum":1},"updatedAt":{"type":"integer","minimum":1},"deadlineAt":{"type":"integer","minimum":1},"sessionId":{"type":"string","minLength":1},"workspace":{"type":"string"},"executionCount":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"summary":{"type":"string"},"progress":{"type":"number","minimum":0,"maximum":1},"result":{},"error":{"type":"string"}},"required":["id","appId","instanceId","title","route","status","revision","scopeRef","attempt","limits","createdAt","updatedAt","deadlineAt","sessionId","executionCount","tokens"],"additionalProperties":false},"maxItems":10}},"required":["tasks"],"additionalProperties":false};

function validate14(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.tasks === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tasks"},message:"must have required property '"+"tasks"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "tasks")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.tasks !== undefined){
let data0 = data.tasks;
if(Array.isArray(data0)){
if(data0.length > 10){
const err2 = {instancePath:instancePath+"/tasks",schemaPath:"#/properties/tasks/maxItems",keyword:"maxItems",params:{limit: 10},message:"must NOT have more than 10 items"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.id === undefined){
const err3 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data1.appId === undefined){
const err4 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "appId"},message:"must have required property '"+"appId"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.instanceId === undefined){
const err5 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "instanceId"},message:"must have required property '"+"instanceId"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.title === undefined){
const err6 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.route === undefined){
const err7 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "route"},message:"must have required property '"+"route"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.status === undefined){
const err8 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1.revision === undefined){
const err9 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data1.scopeRef === undefined){
const err10 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "scopeRef"},message:"must have required property '"+"scopeRef"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data1.attempt === undefined){
const err11 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "attempt"},message:"must have required property '"+"attempt"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data1.limits === undefined){
const err12 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "limits"},message:"must have required property '"+"limits"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data1.createdAt === undefined){
const err13 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data1.updatedAt === undefined){
const err14 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "updatedAt"},message:"must have required property '"+"updatedAt"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data1.deadlineAt === undefined){
const err15 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "deadlineAt"},message:"must have required property '"+"deadlineAt"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data1.sessionId === undefined){
const err16 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "sessionId"},message:"must have required property '"+"sessionId"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data1.executionCount === undefined){
const err17 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "executionCount"},message:"must have required property '"+"executionCount"+"'"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(data1.tokens === undefined){
const err18 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "tokens"},message:"must have required property '"+"tokens"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
for(const key1 in data1){
if(!(func8.call(schema15.properties.tasks.items.properties, key1))){
const err19 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data1.id !== undefined){
let data2 = data1.id;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err20 = {instancePath:instancePath+"/tasks/" + i0+"/id",schemaPath:"#/properties/tasks/items/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/tasks/" + i0+"/id",schemaPath:"#/properties/tasks/items/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data1.appId !== undefined){
let data3 = data1.appId;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err22 = {instancePath:instancePath+"/tasks/" + i0+"/appId",schemaPath:"#/properties/tasks/items/properties/appId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
else {
const err23 = {instancePath:instancePath+"/tasks/" + i0+"/appId",schemaPath:"#/properties/tasks/items/properties/appId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data1.instanceId !== undefined){
let data4 = data1.instanceId;
if(typeof data4 === "string"){
if(func2(data4) < 1){
const err24 = {instancePath:instancePath+"/tasks/" + i0+"/instanceId",schemaPath:"#/properties/tasks/items/properties/instanceId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/tasks/" + i0+"/instanceId",schemaPath:"#/properties/tasks/items/properties/instanceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data1.title !== undefined){
let data5 = data1.title;
if(typeof data5 === "string"){
if(func2(data5) < 1){
const err26 = {instancePath:instancePath+"/tasks/" + i0+"/title",schemaPath:"#/properties/tasks/items/properties/title/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
else {
const err27 = {instancePath:instancePath+"/tasks/" + i0+"/title",schemaPath:"#/properties/tasks/items/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data1.route !== undefined){
let data6 = data1.route;
if(typeof data6 === "string"){
if(func2(data6) < 1){
const err28 = {instancePath:instancePath+"/tasks/" + i0+"/route",schemaPath:"#/properties/tasks/items/properties/route/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
else {
const err29 = {instancePath:instancePath+"/tasks/" + i0+"/route",schemaPath:"#/properties/tasks/items/properties/route/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data1.status !== undefined){
let data7 = data1.status;
if(!(((((data7 === "running") || (data7 === "completed")) || (data7 === "failed")) || (data7 === "cancelled")) || (data7 === "interrupted"))){
const err30 = {instancePath:instancePath+"/tasks/" + i0+"/status",schemaPath:"#/properties/tasks/items/properties/status/enum",keyword:"enum",params:{allowedValues: schema15.properties.tasks.items.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data1.revision !== undefined){
let data8 = data1.revision;
if(!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))){
const err31 = {instancePath:instancePath+"/tasks/" + i0+"/revision",schemaPath:"#/properties/tasks/items/properties/revision/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(typeof data8 == "number"){
if(data8 < 1 || isNaN(data8)){
const err32 = {instancePath:instancePath+"/tasks/" + i0+"/revision",schemaPath:"#/properties/tasks/items/properties/revision/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
}
if(data1.scopeRef !== undefined){
let data9 = data1.scopeRef;
if(typeof data9 === "string"){
if(func2(data9) < 1){
const err33 = {instancePath:instancePath+"/tasks/" + i0+"/scopeRef",schemaPath:"#/properties/tasks/items/properties/scopeRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
else {
const err34 = {instancePath:instancePath+"/tasks/" + i0+"/scopeRef",schemaPath:"#/properties/tasks/items/properties/scopeRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
if(data1.attempt !== undefined){
let data10 = data1.attempt;
if(!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))){
const err35 = {instancePath:instancePath+"/tasks/" + i0+"/attempt",schemaPath:"#/properties/tasks/items/properties/attempt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(typeof data10 == "number"){
if(data10 < 1 || isNaN(data10)){
const err36 = {instancePath:instancePath+"/tasks/" + i0+"/attempt",schemaPath:"#/properties/tasks/items/properties/attempt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
if(data1.limits !== undefined){
let data11 = data1.limits;
if(data11 && typeof data11 == "object" && !Array.isArray(data11)){
if(data11.maxConcurrency === undefined){
const err37 = {instancePath:instancePath+"/tasks/" + i0+"/limits",schemaPath:"#/properties/tasks/items/properties/limits/required",keyword:"required",params:{missingProperty: "maxConcurrency"},message:"must have required property '"+"maxConcurrency"+"'"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(data11.maxCalls === undefined){
const err38 = {instancePath:instancePath+"/tasks/" + i0+"/limits",schemaPath:"#/properties/tasks/items/properties/limits/required",keyword:"required",params:{missingProperty: "maxCalls"},message:"must have required property '"+"maxCalls"+"'"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(data11.maxDurationMs === undefined){
const err39 = {instancePath:instancePath+"/tasks/" + i0+"/limits",schemaPath:"#/properties/tasks/items/properties/limits/required",keyword:"required",params:{missingProperty: "maxDurationMs"},message:"must have required property '"+"maxDurationMs"+"'"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(data11.maxTokens === undefined){
const err40 = {instancePath:instancePath+"/tasks/" + i0+"/limits",schemaPath:"#/properties/tasks/items/properties/limits/required",keyword:"required",params:{missingProperty: "maxTokens"},message:"must have required property '"+"maxTokens"+"'"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
for(const key2 in data11){
if(!((((key2 === "maxConcurrency") || (key2 === "maxCalls")) || (key2 === "maxDurationMs")) || (key2 === "maxTokens"))){
const err41 = {instancePath:instancePath+"/tasks/" + i0+"/limits",schemaPath:"#/properties/tasks/items/properties/limits/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
if(data11.maxConcurrency !== undefined){
let data12 = data11.maxConcurrency;
if(!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))){
const err42 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxConcurrency",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxConcurrency/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(typeof data12 == "number"){
if(data12 < 1 || isNaN(data12)){
const err43 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxConcurrency",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxConcurrency/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
}
if(data11.maxCalls !== undefined){
let data13 = data11.maxCalls;
if(!((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13)))){
const err44 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxCalls",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxCalls/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
if(typeof data13 == "number"){
if(data13 < 1 || isNaN(data13)){
const err45 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxCalls",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxCalls/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
}
if(data11.maxDurationMs !== undefined){
let data14 = data11.maxDurationMs;
if(!((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14)))){
const err46 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxDurationMs",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxDurationMs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if(typeof data14 == "number"){
if(data14 < 1 || isNaN(data14)){
const err47 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxDurationMs",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxDurationMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
}
if(data11.maxTokens !== undefined){
let data15 = data11.maxTokens;
if(!((typeof data15 == "number") && (!(data15 % 1) && !isNaN(data15)))){
const err48 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxTokens",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxTokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
if(typeof data15 == "number"){
if(data15 < 1 || isNaN(data15)){
const err49 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxTokens",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxTokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
}
}
else {
const err50 = {instancePath:instancePath+"/tasks/" + i0+"/limits",schemaPath:"#/properties/tasks/items/properties/limits/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
if(data1.createdAt !== undefined){
let data16 = data1.createdAt;
if(!((typeof data16 == "number") && (!(data16 % 1) && !isNaN(data16)))){
const err51 = {instancePath:instancePath+"/tasks/" + i0+"/createdAt",schemaPath:"#/properties/tasks/items/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
if(typeof data16 == "number"){
if(data16 < 1 || isNaN(data16)){
const err52 = {instancePath:instancePath+"/tasks/" + i0+"/createdAt",schemaPath:"#/properties/tasks/items/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
}
if(data1.updatedAt !== undefined){
let data17 = data1.updatedAt;
if(!((typeof data17 == "number") && (!(data17 % 1) && !isNaN(data17)))){
const err53 = {instancePath:instancePath+"/tasks/" + i0+"/updatedAt",schemaPath:"#/properties/tasks/items/properties/updatedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
if(typeof data17 == "number"){
if(data17 < 1 || isNaN(data17)){
const err54 = {instancePath:instancePath+"/tasks/" + i0+"/updatedAt",schemaPath:"#/properties/tasks/items/properties/updatedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
}
if(data1.deadlineAt !== undefined){
let data18 = data1.deadlineAt;
if(!((typeof data18 == "number") && (!(data18 % 1) && !isNaN(data18)))){
const err55 = {instancePath:instancePath+"/tasks/" + i0+"/deadlineAt",schemaPath:"#/properties/tasks/items/properties/deadlineAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
if(typeof data18 == "number"){
if(data18 < 1 || isNaN(data18)){
const err56 = {instancePath:instancePath+"/tasks/" + i0+"/deadlineAt",schemaPath:"#/properties/tasks/items/properties/deadlineAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
}
}
if(data1.sessionId !== undefined){
let data19 = data1.sessionId;
if(typeof data19 === "string"){
if(func2(data19) < 1){
const err57 = {instancePath:instancePath+"/tasks/" + i0+"/sessionId",schemaPath:"#/properties/tasks/items/properties/sessionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
}
else {
const err58 = {instancePath:instancePath+"/tasks/" + i0+"/sessionId",schemaPath:"#/properties/tasks/items/properties/sessionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
}
if(data1.workspace !== undefined){
if(typeof data1.workspace !== "string"){
const err59 = {instancePath:instancePath+"/tasks/" + i0+"/workspace",schemaPath:"#/properties/tasks/items/properties/workspace/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
}
if(data1.executionCount !== undefined){
let data21 = data1.executionCount;
if(!((typeof data21 == "number") && (!(data21 % 1) && !isNaN(data21)))){
const err60 = {instancePath:instancePath+"/tasks/" + i0+"/executionCount",schemaPath:"#/properties/tasks/items/properties/executionCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
if(typeof data21 == "number"){
if(data21 < 0 || isNaN(data21)){
const err61 = {instancePath:instancePath+"/tasks/" + i0+"/executionCount",schemaPath:"#/properties/tasks/items/properties/executionCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
}
}
if(data1.tokens !== undefined){
let data22 = data1.tokens;
if(!((typeof data22 == "number") && (!(data22 % 1) && !isNaN(data22)))){
const err62 = {instancePath:instancePath+"/tasks/" + i0+"/tokens",schemaPath:"#/properties/tasks/items/properties/tokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
if(typeof data22 == "number"){
if(data22 < 0 || isNaN(data22)){
const err63 = {instancePath:instancePath+"/tasks/" + i0+"/tokens",schemaPath:"#/properties/tasks/items/properties/tokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
}
}
if(data1.summary !== undefined){
if(typeof data1.summary !== "string"){
const err64 = {instancePath:instancePath+"/tasks/" + i0+"/summary",schemaPath:"#/properties/tasks/items/properties/summary/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
}
if(data1.progress !== undefined){
let data24 = data1.progress;
if(typeof data24 == "number"){
if(data24 > 1 || isNaN(data24)){
const err65 = {instancePath:instancePath+"/tasks/" + i0+"/progress",schemaPath:"#/properties/tasks/items/properties/progress/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
if(data24 < 0 || isNaN(data24)){
const err66 = {instancePath:instancePath+"/tasks/" + i0+"/progress",schemaPath:"#/properties/tasks/items/properties/progress/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
}
else {
const err67 = {instancePath:instancePath+"/tasks/" + i0+"/progress",schemaPath:"#/properties/tasks/items/properties/progress/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
}
if(data1.error !== undefined){
if(typeof data1.error !== "string"){
const err68 = {instancePath:instancePath+"/tasks/" + i0+"/error",schemaPath:"#/properties/tasks/items/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
}
}
else {
const err69 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
}
}
else {
const err70 = {instancePath:instancePath+"/tasks",schemaPath:"#/properties/tasks/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
}
}
else {
const err71 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
validate14.errors = vErrors;
return errors === 0;
}

export const v5 = validate15;
const schema16 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"revision":{"type":"integer","minimum":1},"summary":{"type":"string","minLength":1,"maxLength":20000,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"progress":{"type":"number","minimum":0,"maximum":1}},"required":["taskId","revision"],"additionalProperties":false};

function validate15(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.taskId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "taskId"},message:"must have required property '"+"taskId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.revision === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "taskId") || (key0 === "revision")) || (key0 === "summary")) || (key0 === "progress"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.taskId !== undefined){
let data0 = data.taskId;
if(typeof data0 === "string"){
if(func2(data0) > 512){
const err3 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern0.test(data0)){
const err5 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.revision !== undefined){
let data1 = data.revision;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err7 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 1 || isNaN(data1)){
const err8 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
if(data.summary !== undefined){
let data2 = data.summary;
if(typeof data2 === "string"){
if(func2(data2) > 20000){
const err9 = {instancePath:instancePath+"/summary",schemaPath:"#/properties/summary/maxLength",keyword:"maxLength",params:{limit: 20000},message:"must NOT have more than 20000 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func2(data2) < 1){
const err10 = {instancePath:instancePath+"/summary",schemaPath:"#/properties/summary/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(!pattern0.test(data2)){
const err11 = {instancePath:instancePath+"/summary",schemaPath:"#/properties/summary/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/summary",schemaPath:"#/properties/summary/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.progress !== undefined){
let data3 = data.progress;
if(typeof data3 == "number"){
if(data3 > 1 || isNaN(data3)){
const err13 = {instancePath:instancePath+"/progress",schemaPath:"#/properties/progress/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data3 < 0 || isNaN(data3)){
const err14 = {instancePath:instancePath+"/progress",schemaPath:"#/properties/progress/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/progress",schemaPath:"#/properties/progress/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
validate15.errors = vErrors;
return errors === 0;
}

export const v6 = validate16;
const schema17 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"revision":{"type":"integer","minimum":1},"status":{"enum":["completed","failed"]},"summary":{"type":"string","minLength":1,"maxLength":20000,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"result":{}},"required":["taskId","revision","status"],"additionalProperties":false};

function validate16(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.taskId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "taskId"},message:"must have required property '"+"taskId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.revision === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.status === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "taskId") || (key0 === "revision")) || (key0 === "status")) || (key0 === "summary")) || (key0 === "result"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.taskId !== undefined){
let data0 = data.taskId;
if(typeof data0 === "string"){
if(func2(data0) > 512){
const err4 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func2(data0) < 1){
const err5 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern0.test(data0)){
const err6 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.revision !== undefined){
let data1 = data.revision;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err8 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 1 || isNaN(data1)){
const err9 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.status !== undefined){
let data2 = data.status;
if(!((data2 === "completed") || (data2 === "failed"))){
const err10 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema17.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.summary !== undefined){
let data3 = data.summary;
if(typeof data3 === "string"){
if(func2(data3) > 20000){
const err11 = {instancePath:instancePath+"/summary",schemaPath:"#/properties/summary/maxLength",keyword:"maxLength",params:{limit: 20000},message:"must NOT have more than 20000 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func2(data3) < 1){
const err12 = {instancePath:instancePath+"/summary",schemaPath:"#/properties/summary/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(!pattern0.test(data3)){
const err13 = {instancePath:instancePath+"/summary",schemaPath:"#/properties/summary/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/summary",schemaPath:"#/properties/summary/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
}
else {
const err15 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
validate16.errors = vErrors;
return errors === 0;
}

export const v7 = validate17;
const schema18 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"reason":{"type":"string","minLength":1,"maxLength":1024,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"}},"required":["taskId"],"additionalProperties":false};

function validate17(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.taskId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "taskId"},message:"must have required property '"+"taskId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "taskId") || (key0 === "reason"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.taskId !== undefined){
let data0 = data.taskId;
if(typeof data0 === "string"){
if(func2(data0) > 512){
const err2 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern0.test(data0)){
const err4 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.reason !== undefined){
let data1 = data.reason;
if(typeof data1 === "string"){
if(func2(data1) > 1024){
const err6 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func2(data1) < 1){
const err7 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern0.test(data1)){
const err8 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
else {
const err10 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
validate17.errors = vErrors;
return errors === 0;
}

export const v8 = validate18;
const schema19 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"revision":{"type":"integer","minimum":1}},"required":["taskId","revision"],"additionalProperties":false};

function validate18(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.taskId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "taskId"},message:"must have required property '"+"taskId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.revision === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "taskId") || (key0 === "revision"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.taskId !== undefined){
let data0 = data.taskId;
if(typeof data0 === "string"){
if(func2(data0) > 512){
const err3 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern0.test(data0)){
const err5 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.revision !== undefined){
let data1 = data.revision;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err7 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 1 || isNaN(data1)){
const err8 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate18.errors = vErrors;
return errors === 0;
}

export const v9 = validate19;
const schema20 = {"type":"object","properties":{"task":{"type":"object","properties":{"id":{"type":"string","minLength":1},"appId":{"type":"string","minLength":1},"instanceId":{"type":"string","minLength":1},"title":{"type":"string","minLength":1},"route":{"type":"string","minLength":1},"status":{"enum":["running","completed","failed","cancelled","interrupted"]},"revision":{"type":"integer","minimum":1},"scopeRef":{"type":"string","minLength":1},"attempt":{"type":"integer","minimum":1},"limits":{"type":"object","properties":{"maxConcurrency":{"type":"integer","minimum":1},"maxCalls":{"type":"integer","minimum":1},"maxDurationMs":{"type":"integer","minimum":1},"maxTokens":{"type":"integer","minimum":1}},"required":["maxConcurrency","maxCalls","maxDurationMs","maxTokens"],"additionalProperties":false},"createdAt":{"type":"integer","minimum":1},"updatedAt":{"type":"integer","minimum":1},"deadlineAt":{"type":"integer","minimum":1},"sessionId":{"type":"string","minLength":1},"workspace":{"type":"string"},"executionCount":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"summary":{"type":"string"},"progress":{"type":"number","minimum":0,"maximum":1},"result":{},"error":{"type":"string"}},"required":["id","appId","instanceId","title","route","status","revision","scopeRef","attempt","limits","createdAt","updatedAt","deadlineAt","sessionId","executionCount","tokens"],"additionalProperties":false}},"required":["task"],"additionalProperties":false};

function validate19(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.task === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "task"},message:"must have required property '"+"task"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "task")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.task !== undefined){
let data0 = data.task;
if(data0 && typeof data0 == "object" && !Array.isArray(data0)){
if(data0.id === undefined){
const err2 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data0.appId === undefined){
const err3 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "appId"},message:"must have required property '"+"appId"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data0.instanceId === undefined){
const err4 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "instanceId"},message:"must have required property '"+"instanceId"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data0.title === undefined){
const err5 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data0.route === undefined){
const err6 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "route"},message:"must have required property '"+"route"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data0.status === undefined){
const err7 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data0.revision === undefined){
const err8 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data0.scopeRef === undefined){
const err9 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "scopeRef"},message:"must have required property '"+"scopeRef"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data0.attempt === undefined){
const err10 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "attempt"},message:"must have required property '"+"attempt"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data0.limits === undefined){
const err11 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "limits"},message:"must have required property '"+"limits"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data0.createdAt === undefined){
const err12 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data0.updatedAt === undefined){
const err13 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "updatedAt"},message:"must have required property '"+"updatedAt"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data0.deadlineAt === undefined){
const err14 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "deadlineAt"},message:"must have required property '"+"deadlineAt"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data0.sessionId === undefined){
const err15 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "sessionId"},message:"must have required property '"+"sessionId"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data0.executionCount === undefined){
const err16 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "executionCount"},message:"must have required property '"+"executionCount"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data0.tokens === undefined){
const err17 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/required",keyword:"required",params:{missingProperty: "tokens"},message:"must have required property '"+"tokens"+"'"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
for(const key1 in data0){
if(!(func8.call(schema20.properties.task.properties, key1))){
const err18 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data0.id !== undefined){
let data1 = data0.id;
if(typeof data1 === "string"){
if(func2(data1) < 1){
const err19 = {instancePath:instancePath+"/task/id",schemaPath:"#/properties/task/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
else {
const err20 = {instancePath:instancePath+"/task/id",schemaPath:"#/properties/task/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data0.appId !== undefined){
let data2 = data0.appId;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err21 = {instancePath:instancePath+"/task/appId",schemaPath:"#/properties/task/properties/appId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
else {
const err22 = {instancePath:instancePath+"/task/appId",schemaPath:"#/properties/task/properties/appId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data0.instanceId !== undefined){
let data3 = data0.instanceId;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err23 = {instancePath:instancePath+"/task/instanceId",schemaPath:"#/properties/task/properties/instanceId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/task/instanceId",schemaPath:"#/properties/task/properties/instanceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data0.title !== undefined){
let data4 = data0.title;
if(typeof data4 === "string"){
if(func2(data4) < 1){
const err25 = {instancePath:instancePath+"/task/title",schemaPath:"#/properties/task/properties/title/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/task/title",schemaPath:"#/properties/task/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data0.route !== undefined){
let data5 = data0.route;
if(typeof data5 === "string"){
if(func2(data5) < 1){
const err27 = {instancePath:instancePath+"/task/route",schemaPath:"#/properties/task/properties/route/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/task/route",schemaPath:"#/properties/task/properties/route/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data0.status !== undefined){
let data6 = data0.status;
if(!(((((data6 === "running") || (data6 === "completed")) || (data6 === "failed")) || (data6 === "cancelled")) || (data6 === "interrupted"))){
const err29 = {instancePath:instancePath+"/task/status",schemaPath:"#/properties/task/properties/status/enum",keyword:"enum",params:{allowedValues: schema20.properties.task.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data0.revision !== undefined){
let data7 = data0.revision;
if(!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))){
const err30 = {instancePath:instancePath+"/task/revision",schemaPath:"#/properties/task/properties/revision/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(typeof data7 == "number"){
if(data7 < 1 || isNaN(data7)){
const err31 = {instancePath:instancePath+"/task/revision",schemaPath:"#/properties/task/properties/revision/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
}
if(data0.scopeRef !== undefined){
let data8 = data0.scopeRef;
if(typeof data8 === "string"){
if(func2(data8) < 1){
const err32 = {instancePath:instancePath+"/task/scopeRef",schemaPath:"#/properties/task/properties/scopeRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
else {
const err33 = {instancePath:instancePath+"/task/scopeRef",schemaPath:"#/properties/task/properties/scopeRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data0.attempt !== undefined){
let data9 = data0.attempt;
if(!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))){
const err34 = {instancePath:instancePath+"/task/attempt",schemaPath:"#/properties/task/properties/attempt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(typeof data9 == "number"){
if(data9 < 1 || isNaN(data9)){
const err35 = {instancePath:instancePath+"/task/attempt",schemaPath:"#/properties/task/properties/attempt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
if(data0.limits !== undefined){
let data10 = data0.limits;
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
if(data10.maxConcurrency === undefined){
const err36 = {instancePath:instancePath+"/task/limits",schemaPath:"#/properties/task/properties/limits/required",keyword:"required",params:{missingProperty: "maxConcurrency"},message:"must have required property '"+"maxConcurrency"+"'"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(data10.maxCalls === undefined){
const err37 = {instancePath:instancePath+"/task/limits",schemaPath:"#/properties/task/properties/limits/required",keyword:"required",params:{missingProperty: "maxCalls"},message:"must have required property '"+"maxCalls"+"'"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(data10.maxDurationMs === undefined){
const err38 = {instancePath:instancePath+"/task/limits",schemaPath:"#/properties/task/properties/limits/required",keyword:"required",params:{missingProperty: "maxDurationMs"},message:"must have required property '"+"maxDurationMs"+"'"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(data10.maxTokens === undefined){
const err39 = {instancePath:instancePath+"/task/limits",schemaPath:"#/properties/task/properties/limits/required",keyword:"required",params:{missingProperty: "maxTokens"},message:"must have required property '"+"maxTokens"+"'"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
for(const key2 in data10){
if(!((((key2 === "maxConcurrency") || (key2 === "maxCalls")) || (key2 === "maxDurationMs")) || (key2 === "maxTokens"))){
const err40 = {instancePath:instancePath+"/task/limits",schemaPath:"#/properties/task/properties/limits/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
if(data10.maxConcurrency !== undefined){
let data11 = data10.maxConcurrency;
if(!((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11)))){
const err41 = {instancePath:instancePath+"/task/limits/maxConcurrency",schemaPath:"#/properties/task/properties/limits/properties/maxConcurrency/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
if(typeof data11 == "number"){
if(data11 < 1 || isNaN(data11)){
const err42 = {instancePath:instancePath+"/task/limits/maxConcurrency",schemaPath:"#/properties/task/properties/limits/properties/maxConcurrency/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
}
if(data10.maxCalls !== undefined){
let data12 = data10.maxCalls;
if(!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))){
const err43 = {instancePath:instancePath+"/task/limits/maxCalls",schemaPath:"#/properties/task/properties/limits/properties/maxCalls/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if(typeof data12 == "number"){
if(data12 < 1 || isNaN(data12)){
const err44 = {instancePath:instancePath+"/task/limits/maxCalls",schemaPath:"#/properties/task/properties/limits/properties/maxCalls/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
}
if(data10.maxDurationMs !== undefined){
let data13 = data10.maxDurationMs;
if(!((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13)))){
const err45 = {instancePath:instancePath+"/task/limits/maxDurationMs",schemaPath:"#/properties/task/properties/limits/properties/maxDurationMs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if(typeof data13 == "number"){
if(data13 < 1 || isNaN(data13)){
const err46 = {instancePath:instancePath+"/task/limits/maxDurationMs",schemaPath:"#/properties/task/properties/limits/properties/maxDurationMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
}
if(data10.maxTokens !== undefined){
let data14 = data10.maxTokens;
if(!((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14)))){
const err47 = {instancePath:instancePath+"/task/limits/maxTokens",schemaPath:"#/properties/task/properties/limits/properties/maxTokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
if(typeof data14 == "number"){
if(data14 < 1 || isNaN(data14)){
const err48 = {instancePath:instancePath+"/task/limits/maxTokens",schemaPath:"#/properties/task/properties/limits/properties/maxTokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
}
}
else {
const err49 = {instancePath:instancePath+"/task/limits",schemaPath:"#/properties/task/properties/limits/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data0.createdAt !== undefined){
let data15 = data0.createdAt;
if(!((typeof data15 == "number") && (!(data15 % 1) && !isNaN(data15)))){
const err50 = {instancePath:instancePath+"/task/createdAt",schemaPath:"#/properties/task/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
if(typeof data15 == "number"){
if(data15 < 1 || isNaN(data15)){
const err51 = {instancePath:instancePath+"/task/createdAt",schemaPath:"#/properties/task/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
}
if(data0.updatedAt !== undefined){
let data16 = data0.updatedAt;
if(!((typeof data16 == "number") && (!(data16 % 1) && !isNaN(data16)))){
const err52 = {instancePath:instancePath+"/task/updatedAt",schemaPath:"#/properties/task/properties/updatedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
if(typeof data16 == "number"){
if(data16 < 1 || isNaN(data16)){
const err53 = {instancePath:instancePath+"/task/updatedAt",schemaPath:"#/properties/task/properties/updatedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
}
if(data0.deadlineAt !== undefined){
let data17 = data0.deadlineAt;
if(!((typeof data17 == "number") && (!(data17 % 1) && !isNaN(data17)))){
const err54 = {instancePath:instancePath+"/task/deadlineAt",schemaPath:"#/properties/task/properties/deadlineAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
if(typeof data17 == "number"){
if(data17 < 1 || isNaN(data17)){
const err55 = {instancePath:instancePath+"/task/deadlineAt",schemaPath:"#/properties/task/properties/deadlineAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
}
if(data0.sessionId !== undefined){
let data18 = data0.sessionId;
if(typeof data18 === "string"){
if(func2(data18) < 1){
const err56 = {instancePath:instancePath+"/task/sessionId",schemaPath:"#/properties/task/properties/sessionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
}
else {
const err57 = {instancePath:instancePath+"/task/sessionId",schemaPath:"#/properties/task/properties/sessionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
}
if(data0.workspace !== undefined){
if(typeof data0.workspace !== "string"){
const err58 = {instancePath:instancePath+"/task/workspace",schemaPath:"#/properties/task/properties/workspace/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
}
if(data0.executionCount !== undefined){
let data20 = data0.executionCount;
if(!((typeof data20 == "number") && (!(data20 % 1) && !isNaN(data20)))){
const err59 = {instancePath:instancePath+"/task/executionCount",schemaPath:"#/properties/task/properties/executionCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
if(typeof data20 == "number"){
if(data20 < 0 || isNaN(data20)){
const err60 = {instancePath:instancePath+"/task/executionCount",schemaPath:"#/properties/task/properties/executionCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
}
}
if(data0.tokens !== undefined){
let data21 = data0.tokens;
if(!((typeof data21 == "number") && (!(data21 % 1) && !isNaN(data21)))){
const err61 = {instancePath:instancePath+"/task/tokens",schemaPath:"#/properties/task/properties/tokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
if(typeof data21 == "number"){
if(data21 < 0 || isNaN(data21)){
const err62 = {instancePath:instancePath+"/task/tokens",schemaPath:"#/properties/task/properties/tokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
}
}
if(data0.summary !== undefined){
if(typeof data0.summary !== "string"){
const err63 = {instancePath:instancePath+"/task/summary",schemaPath:"#/properties/task/properties/summary/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
}
if(data0.progress !== undefined){
let data23 = data0.progress;
if(typeof data23 == "number"){
if(data23 > 1 || isNaN(data23)){
const err64 = {instancePath:instancePath+"/task/progress",schemaPath:"#/properties/task/properties/progress/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
if(data23 < 0 || isNaN(data23)){
const err65 = {instancePath:instancePath+"/task/progress",schemaPath:"#/properties/task/properties/progress/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
}
else {
const err66 = {instancePath:instancePath+"/task/progress",schemaPath:"#/properties/task/properties/progress/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
}
if(data0.error !== undefined){
if(typeof data0.error !== "string"){
const err67 = {instancePath:instancePath+"/task/error",schemaPath:"#/properties/task/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
}
}
else {
const err68 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
}
}
else {
const err69 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
validate19.errors = vErrors;
return errors === 0;
}

export const v10 = validate20;
const schema21 = {"type":"object","properties":{},"required":[],"additionalProperties":false};

function validate20(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
const err0 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate20.errors = vErrors;
return errors === 0;
}

export const v11 = validate21;
const schema22 = {"type":"object","properties":{"environment":{"const":"local"},"structuredOutput":{"type":"boolean"},"contextReuse":{"type":"boolean"},"maxConcurrency":{"type":"integer","minimum":1},"events":{"type":"boolean"}},"required":["environment","structuredOutput","contextReuse","maxConcurrency","events"],"additionalProperties":false};

function validate21(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.environment === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "environment"},message:"must have required property '"+"environment"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.structuredOutput === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "structuredOutput"},message:"must have required property '"+"structuredOutput"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contextReuse === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextReuse"},message:"must have required property '"+"contextReuse"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.maxConcurrency === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "maxConcurrency"},message:"must have required property '"+"maxConcurrency"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.events === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "events"},message:"must have required property '"+"events"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "environment") || (key0 === "structuredOutput")) || (key0 === "contextReuse")) || (key0 === "maxConcurrency")) || (key0 === "events"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.environment !== undefined){
if("local" !== data.environment){
const err6 = {instancePath:instancePath+"/environment",schemaPath:"#/properties/environment/const",keyword:"const",params:{allowedValue: "local"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.structuredOutput !== undefined){
if(typeof data.structuredOutput !== "boolean"){
const err7 = {instancePath:instancePath+"/structuredOutput",schemaPath:"#/properties/structuredOutput/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.contextReuse !== undefined){
if(typeof data.contextReuse !== "boolean"){
const err8 = {instancePath:instancePath+"/contextReuse",schemaPath:"#/properties/contextReuse/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.maxConcurrency !== undefined){
let data3 = data.maxConcurrency;
if(!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))){
const err9 = {instancePath:instancePath+"/maxConcurrency",schemaPath:"#/properties/maxConcurrency/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(typeof data3 == "number"){
if(data3 < 1 || isNaN(data3)){
const err10 = {instancePath:instancePath+"/maxConcurrency",schemaPath:"#/properties/maxConcurrency/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
if(data.events !== undefined){
if(typeof data.events !== "boolean"){
const err11 = {instancePath:instancePath+"/events",schemaPath:"#/properties/events/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate21.errors = vErrors;
return errors === 0;
}

export const v12 = validate22;
const schema23 = {"type":"object","properties":{"scopeRef":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"idempotencyKey":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"contextKey":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"prompt":{"type":"string","minLength":1,"maxLength":100000,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"outputSchema":{"anyOf":[{"type":"object","additionalProperties":true},{"type":"boolean"}]},"agentType":{"type":"string","minLength":1,"maxLength":1024,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"resources":{"type":"object","properties":{"tools":{"type":"array","maxItems":512,"items":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"}}},"required":["tools"],"additionalProperties":false},"timeoutMs":{"type":"integer","minimum":1,"maximum":1800000}},"required":["scopeRef","idempotencyKey","contextKey","prompt","outputSchema"],"additionalProperties":false};

function validate22(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.scopeRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "scopeRef"},message:"must have required property '"+"scopeRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.idempotencyKey === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "idempotencyKey"},message:"must have required property '"+"idempotencyKey"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contextKey === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextKey"},message:"must have required property '"+"contextKey"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.prompt === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "prompt"},message:"must have required property '"+"prompt"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.outputSchema === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "outputSchema"},message:"must have required property '"+"outputSchema"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "scopeRef") || (key0 === "idempotencyKey")) || (key0 === "contextKey")) || (key0 === "prompt")) || (key0 === "outputSchema")) || (key0 === "agentType")) || (key0 === "resources")) || (key0 === "timeoutMs"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.scopeRef !== undefined){
let data0 = data.scopeRef;
if(typeof data0 === "string"){
if(func2(data0) > 512){
const err6 = {instancePath:instancePath+"/scopeRef",schemaPath:"#/properties/scopeRef/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func2(data0) < 1){
const err7 = {instancePath:instancePath+"/scopeRef",schemaPath:"#/properties/scopeRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern0.test(data0)){
const err8 = {instancePath:instancePath+"/scopeRef",schemaPath:"#/properties/scopeRef/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/scopeRef",schemaPath:"#/properties/scopeRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.idempotencyKey !== undefined){
let data1 = data.idempotencyKey;
if(typeof data1 === "string"){
if(func2(data1) > 512){
const err10 = {instancePath:instancePath+"/idempotencyKey",schemaPath:"#/properties/idempotencyKey/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func2(data1) < 1){
const err11 = {instancePath:instancePath+"/idempotencyKey",schemaPath:"#/properties/idempotencyKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!pattern0.test(data1)){
const err12 = {instancePath:instancePath+"/idempotencyKey",schemaPath:"#/properties/idempotencyKey/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/idempotencyKey",schemaPath:"#/properties/idempotencyKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.contextKey !== undefined){
let data2 = data.contextKey;
if(typeof data2 === "string"){
if(func2(data2) > 512){
const err14 = {instancePath:instancePath+"/contextKey",schemaPath:"#/properties/contextKey/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func2(data2) < 1){
const err15 = {instancePath:instancePath+"/contextKey",schemaPath:"#/properties/contextKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(!pattern0.test(data2)){
const err16 = {instancePath:instancePath+"/contextKey",schemaPath:"#/properties/contextKey/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/contextKey",schemaPath:"#/properties/contextKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.prompt !== undefined){
let data3 = data.prompt;
if(typeof data3 === "string"){
if(func2(data3) > 100000){
const err18 = {instancePath:instancePath+"/prompt",schemaPath:"#/properties/prompt/maxLength",keyword:"maxLength",params:{limit: 100000},message:"must NOT have more than 100000 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(func2(data3) < 1){
const err19 = {instancePath:instancePath+"/prompt",schemaPath:"#/properties/prompt/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(!pattern0.test(data3)){
const err20 = {instancePath:instancePath+"/prompt",schemaPath:"#/properties/prompt/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/prompt",schemaPath:"#/properties/prompt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.outputSchema !== undefined){
let data4 = data.outputSchema;
const _errs11 = errors;
let valid1 = false;
const _errs12 = errors;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
}
else {
const err22 = {instancePath:instancePath+"/outputSchema",schemaPath:"#/properties/outputSchema/anyOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
var _valid0 = _errs12 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs15 = errors;
if(typeof data4 !== "boolean"){
const err23 = {instancePath:instancePath+"/outputSchema",schemaPath:"#/properties/outputSchema/anyOf/1/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
var _valid0 = _errs15 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err24 = {instancePath:instancePath+"/outputSchema",schemaPath:"#/properties/outputSchema/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
else {
errors = _errs11;
if(vErrors !== null){
if(_errs11){
vErrors.length = _errs11;
}
else {
vErrors = null;
}
}
}
}
if(data.agentType !== undefined){
let data5 = data.agentType;
if(typeof data5 === "string"){
if(func2(data5) > 1024){
const err25 = {instancePath:instancePath+"/agentType",schemaPath:"#/properties/agentType/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(func2(data5) < 1){
const err26 = {instancePath:instancePath+"/agentType",schemaPath:"#/properties/agentType/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(!pattern0.test(data5)){
const err27 = {instancePath:instancePath+"/agentType",schemaPath:"#/properties/agentType/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/agentType",schemaPath:"#/properties/agentType/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.resources !== undefined){
let data6 = data.resources;
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
if(data6.tools === undefined){
const err29 = {instancePath:instancePath+"/resources",schemaPath:"#/properties/resources/required",keyword:"required",params:{missingProperty: "tools"},message:"must have required property '"+"tools"+"'"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
for(const key1 in data6){
if(!(key1 === "tools")){
const err30 = {instancePath:instancePath+"/resources",schemaPath:"#/properties/resources/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data6.tools !== undefined){
let data7 = data6.tools;
if(Array.isArray(data7)){
if(data7.length > 512){
const err31 = {instancePath:instancePath+"/resources/tools",schemaPath:"#/properties/resources/properties/tools/maxItems",keyword:"maxItems",params:{limit: 512},message:"must NOT have more than 512 items"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
const len0 = data7.length;
for(let i0=0; i0<len0; i0++){
let data8 = data7[i0];
if(typeof data8 === "string"){
if(func2(data8) > 512){
const err32 = {instancePath:instancePath+"/resources/tools/" + i0,schemaPath:"#/properties/resources/properties/tools/items/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(func2(data8) < 1){
const err33 = {instancePath:instancePath+"/resources/tools/" + i0,schemaPath:"#/properties/resources/properties/tools/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(!pattern0.test(data8)){
const err34 = {instancePath:instancePath+"/resources/tools/" + i0,schemaPath:"#/properties/resources/properties/tools/items/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
else {
const err35 = {instancePath:instancePath+"/resources/tools/" + i0,schemaPath:"#/properties/resources/properties/tools/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
else {
const err36 = {instancePath:instancePath+"/resources/tools",schemaPath:"#/properties/resources/properties/tools/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
else {
const err37 = {instancePath:instancePath+"/resources",schemaPath:"#/properties/resources/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data.timeoutMs !== undefined){
let data9 = data.timeoutMs;
if(!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))){
const err38 = {instancePath:instancePath+"/timeoutMs",schemaPath:"#/properties/timeoutMs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(typeof data9 == "number"){
if(data9 > 1800000 || isNaN(data9)){
const err39 = {instancePath:instancePath+"/timeoutMs",schemaPath:"#/properties/timeoutMs/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1800000},message:"must be <= 1800000"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(data9 < 1 || isNaN(data9)){
const err40 = {instancePath:instancePath+"/timeoutMs",schemaPath:"#/properties/timeoutMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
}
}
else {
const err41 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
validate22.errors = vErrors;
return errors === 0;
}

export const v13 = validate23;
const schema24 = {"type":"object","properties":{"id":{"type":"string","minLength":1},"key":{"type":"string","minLength":1},"taskId":{"type":"string","minLength":1},"contextKey":{"type":"string","minLength":1},"contextRef":{"type":"string","minLength":1},"status":{"enum":["queued","running","completed","failed","cancelled","interrupted"]},"sequence":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"toolCalls":{"type":"integer","minimum":0},"createdAt":{"type":"integer","minimum":1},"attempt":{"type":"integer","minimum":1},"resultRef":{"type":"string","minLength":1},"error":{"type":"string"}},"required":["id","key","taskId","contextKey","contextRef","status","sequence","tokens","toolCalls","createdAt","attempt"],"additionalProperties":false};

function validate23(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.key === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.taskId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "taskId"},message:"must have required property '"+"taskId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.contextKey === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextKey"},message:"must have required property '"+"contextKey"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.contextRef === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextRef"},message:"must have required property '"+"contextRef"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.status === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.sequence === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sequence"},message:"must have required property '"+"sequence"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.tokens === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tokens"},message:"must have required property '"+"tokens"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.toolCalls === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "toolCalls"},message:"must have required property '"+"toolCalls"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.createdAt === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.attempt === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "attempt"},message:"must have required property '"+"attempt"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
for(const key0 in data){
if(!(func8.call(schema24.properties, key0))){
const err11 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(typeof data0 === "string"){
if(func2(data0) < 1){
const err12 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.key !== undefined){
let data1 = data.key;
if(typeof data1 === "string"){
if(func2(data1) < 1){
const err14 = {instancePath:instancePath+"/key",schemaPath:"#/properties/key/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/key",schemaPath:"#/properties/key/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.taskId !== undefined){
let data2 = data.taskId;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err16 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.contextKey !== undefined){
let data3 = data.contextKey;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err18 = {instancePath:instancePath+"/contextKey",schemaPath:"#/properties/contextKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/contextKey",schemaPath:"#/properties/contextKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.contextRef !== undefined){
let data4 = data.contextRef;
if(typeof data4 === "string"){
if(func2(data4) < 1){
const err20 = {instancePath:instancePath+"/contextRef",schemaPath:"#/properties/contextRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/contextRef",schemaPath:"#/properties/contextRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.status !== undefined){
let data5 = data.status;
if(!((((((data5 === "queued") || (data5 === "running")) || (data5 === "completed")) || (data5 === "failed")) || (data5 === "cancelled")) || (data5 === "interrupted"))){
const err22 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema24.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.sequence !== undefined){
let data6 = data.sequence;
if(!((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6)))){
const err23 = {instancePath:instancePath+"/sequence",schemaPath:"#/properties/sequence/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(typeof data6 == "number"){
if(data6 < 0 || isNaN(data6)){
const err24 = {instancePath:instancePath+"/sequence",schemaPath:"#/properties/sequence/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
if(data.tokens !== undefined){
let data7 = data.tokens;
if(!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))){
const err25 = {instancePath:instancePath+"/tokens",schemaPath:"#/properties/tokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(typeof data7 == "number"){
if(data7 < 0 || isNaN(data7)){
const err26 = {instancePath:instancePath+"/tokens",schemaPath:"#/properties/tokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
if(data.toolCalls !== undefined){
let data8 = data.toolCalls;
if(!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))){
const err27 = {instancePath:instancePath+"/toolCalls",schemaPath:"#/properties/toolCalls/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(typeof data8 == "number"){
if(data8 < 0 || isNaN(data8)){
const err28 = {instancePath:instancePath+"/toolCalls",schemaPath:"#/properties/toolCalls/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
}
if(data.createdAt !== undefined){
let data9 = data.createdAt;
if(!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))){
const err29 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(typeof data9 == "number"){
if(data9 < 1 || isNaN(data9)){
const err30 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
}
if(data.attempt !== undefined){
let data10 = data.attempt;
if(!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))){
const err31 = {instancePath:instancePath+"/attempt",schemaPath:"#/properties/attempt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(typeof data10 == "number"){
if(data10 < 1 || isNaN(data10)){
const err32 = {instancePath:instancePath+"/attempt",schemaPath:"#/properties/attempt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
}
if(data.resultRef !== undefined){
let data11 = data.resultRef;
if(typeof data11 === "string"){
if(func2(data11) < 1){
const err33 = {instancePath:instancePath+"/resultRef",schemaPath:"#/properties/resultRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
else {
const err34 = {instancePath:instancePath+"/resultRef",schemaPath:"#/properties/resultRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
if(data.error !== undefined){
if(typeof data.error !== "string"){
const err35 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
else {
const err36 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
validate23.errors = vErrors;
return errors === 0;
}

export const v14 = validate24;
const schema25 = {"type":"object","properties":{"executionId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"}},"required":["executionId"],"additionalProperties":false};

function validate24(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.executionId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "executionId"},message:"must have required property '"+"executionId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "executionId")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.executionId !== undefined){
let data0 = data.executionId;
if(typeof data0 === "string"){
if(func2(data0) > 512){
const err2 = {instancePath:instancePath+"/executionId",schemaPath:"#/properties/executionId/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/executionId",schemaPath:"#/properties/executionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern0.test(data0)){
const err4 = {instancePath:instancePath+"/executionId",schemaPath:"#/properties/executionId/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/executionId",schemaPath:"#/properties/executionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate24.errors = vErrors;
return errors === 0;
}

export const v15 = validate25;
const schema26 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"}},"required":["taskId"],"additionalProperties":false};

function validate25(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.taskId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "taskId"},message:"must have required property '"+"taskId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "taskId")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.taskId !== undefined){
let data0 = data.taskId;
if(typeof data0 === "string"){
if(func2(data0) > 512){
const err2 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern0.test(data0)){
const err4 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate25.errors = vErrors;
return errors === 0;
}

export const v16 = validate26;
const schema27 = {"type":"object","properties":{"executions":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1},"key":{"type":"string","minLength":1},"taskId":{"type":"string","minLength":1},"contextKey":{"type":"string","minLength":1},"contextRef":{"type":"string","minLength":1},"status":{"enum":["queued","running","completed","failed","cancelled","interrupted"]},"sequence":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"toolCalls":{"type":"integer","minimum":0},"createdAt":{"type":"integer","minimum":1},"attempt":{"type":"integer","minimum":1},"resultRef":{"type":"string","minLength":1},"error":{"type":"string"}},"required":["id","key","taskId","contextKey","contextRef","status","sequence","tokens","toolCalls","createdAt","attempt"],"additionalProperties":false},"maxItems":256}},"required":["executions"],"additionalProperties":false};

function validate26(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.executions === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "executions"},message:"must have required property '"+"executions"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "executions")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.executions !== undefined){
let data0 = data.executions;
if(Array.isArray(data0)){
if(data0.length > 256){
const err2 = {instancePath:instancePath+"/executions",schemaPath:"#/properties/executions/maxItems",keyword:"maxItems",params:{limit: 256},message:"must NOT have more than 256 items"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.id === undefined){
const err3 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data1.key === undefined){
const err4 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.taskId === undefined){
const err5 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/required",keyword:"required",params:{missingProperty: "taskId"},message:"must have required property '"+"taskId"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.contextKey === undefined){
const err6 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/required",keyword:"required",params:{missingProperty: "contextKey"},message:"must have required property '"+"contextKey"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.contextRef === undefined){
const err7 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/required",keyword:"required",params:{missingProperty: "contextRef"},message:"must have required property '"+"contextRef"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.status === undefined){
const err8 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1.sequence === undefined){
const err9 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/required",keyword:"required",params:{missingProperty: "sequence"},message:"must have required property '"+"sequence"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data1.tokens === undefined){
const err10 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/required",keyword:"required",params:{missingProperty: "tokens"},message:"must have required property '"+"tokens"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data1.toolCalls === undefined){
const err11 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/required",keyword:"required",params:{missingProperty: "toolCalls"},message:"must have required property '"+"toolCalls"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data1.createdAt === undefined){
const err12 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data1.attempt === undefined){
const err13 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/required",keyword:"required",params:{missingProperty: "attempt"},message:"must have required property '"+"attempt"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
for(const key1 in data1){
if(!(func8.call(schema27.properties.executions.items.properties, key1))){
const err14 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data1.id !== undefined){
let data2 = data1.id;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err15 = {instancePath:instancePath+"/executions/" + i0+"/id",schemaPath:"#/properties/executions/items/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/executions/" + i0+"/id",schemaPath:"#/properties/executions/items/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data1.key !== undefined){
let data3 = data1.key;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err17 = {instancePath:instancePath+"/executions/" + i0+"/key",schemaPath:"#/properties/executions/items/properties/key/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/executions/" + i0+"/key",schemaPath:"#/properties/executions/items/properties/key/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data1.taskId !== undefined){
let data4 = data1.taskId;
if(typeof data4 === "string"){
if(func2(data4) < 1){
const err19 = {instancePath:instancePath+"/executions/" + i0+"/taskId",schemaPath:"#/properties/executions/items/properties/taskId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
else {
const err20 = {instancePath:instancePath+"/executions/" + i0+"/taskId",schemaPath:"#/properties/executions/items/properties/taskId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data1.contextKey !== undefined){
let data5 = data1.contextKey;
if(typeof data5 === "string"){
if(func2(data5) < 1){
const err21 = {instancePath:instancePath+"/executions/" + i0+"/contextKey",schemaPath:"#/properties/executions/items/properties/contextKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
else {
const err22 = {instancePath:instancePath+"/executions/" + i0+"/contextKey",schemaPath:"#/properties/executions/items/properties/contextKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data1.contextRef !== undefined){
let data6 = data1.contextRef;
if(typeof data6 === "string"){
if(func2(data6) < 1){
const err23 = {instancePath:instancePath+"/executions/" + i0+"/contextRef",schemaPath:"#/properties/executions/items/properties/contextRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/executions/" + i0+"/contextRef",schemaPath:"#/properties/executions/items/properties/contextRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data1.status !== undefined){
let data7 = data1.status;
if(!((((((data7 === "queued") || (data7 === "running")) || (data7 === "completed")) || (data7 === "failed")) || (data7 === "cancelled")) || (data7 === "interrupted"))){
const err25 = {instancePath:instancePath+"/executions/" + i0+"/status",schemaPath:"#/properties/executions/items/properties/status/enum",keyword:"enum",params:{allowedValues: schema27.properties.executions.items.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data1.sequence !== undefined){
let data8 = data1.sequence;
if(!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))){
const err26 = {instancePath:instancePath+"/executions/" + i0+"/sequence",schemaPath:"#/properties/executions/items/properties/sequence/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(typeof data8 == "number"){
if(data8 < 0 || isNaN(data8)){
const err27 = {instancePath:instancePath+"/executions/" + i0+"/sequence",schemaPath:"#/properties/executions/items/properties/sequence/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
}
if(data1.tokens !== undefined){
let data9 = data1.tokens;
if(!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))){
const err28 = {instancePath:instancePath+"/executions/" + i0+"/tokens",schemaPath:"#/properties/executions/items/properties/tokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(typeof data9 == "number"){
if(data9 < 0 || isNaN(data9)){
const err29 = {instancePath:instancePath+"/executions/" + i0+"/tokens",schemaPath:"#/properties/executions/items/properties/tokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
if(data1.toolCalls !== undefined){
let data10 = data1.toolCalls;
if(!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))){
const err30 = {instancePath:instancePath+"/executions/" + i0+"/toolCalls",schemaPath:"#/properties/executions/items/properties/toolCalls/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(typeof data10 == "number"){
if(data10 < 0 || isNaN(data10)){
const err31 = {instancePath:instancePath+"/executions/" + i0+"/toolCalls",schemaPath:"#/properties/executions/items/properties/toolCalls/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
}
if(data1.createdAt !== undefined){
let data11 = data1.createdAt;
if(!((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11)))){
const err32 = {instancePath:instancePath+"/executions/" + i0+"/createdAt",schemaPath:"#/properties/executions/items/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(typeof data11 == "number"){
if(data11 < 1 || isNaN(data11)){
const err33 = {instancePath:instancePath+"/executions/" + i0+"/createdAt",schemaPath:"#/properties/executions/items/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
if(data1.attempt !== undefined){
let data12 = data1.attempt;
if(!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))){
const err34 = {instancePath:instancePath+"/executions/" + i0+"/attempt",schemaPath:"#/properties/executions/items/properties/attempt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(typeof data12 == "number"){
if(data12 < 1 || isNaN(data12)){
const err35 = {instancePath:instancePath+"/executions/" + i0+"/attempt",schemaPath:"#/properties/executions/items/properties/attempt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
if(data1.resultRef !== undefined){
let data13 = data1.resultRef;
if(typeof data13 === "string"){
if(func2(data13) < 1){
const err36 = {instancePath:instancePath+"/executions/" + i0+"/resultRef",schemaPath:"#/properties/executions/items/properties/resultRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
else {
const err37 = {instancePath:instancePath+"/executions/" + i0+"/resultRef",schemaPath:"#/properties/executions/items/properties/resultRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data1.error !== undefined){
if(typeof data1.error !== "string"){
const err38 = {instancePath:instancePath+"/executions/" + i0+"/error",schemaPath:"#/properties/executions/items/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
}
else {
const err39 = {instancePath:instancePath+"/executions/" + i0,schemaPath:"#/properties/executions/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
}
else {
const err40 = {instancePath:instancePath+"/executions",schemaPath:"#/properties/executions/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
}
else {
const err41 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
validate26.errors = vErrors;
return errors === 0;
}

export const v17 = validate27;
const schema28 = {"type":"object","properties":{"executionId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"reason":{"type":"string","minLength":1,"maxLength":1024,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"}},"required":["executionId"],"additionalProperties":false};

function validate27(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.executionId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "executionId"},message:"must have required property '"+"executionId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "executionId") || (key0 === "reason"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.executionId !== undefined){
let data0 = data.executionId;
if(typeof data0 === "string"){
if(func2(data0) > 512){
const err2 = {instancePath:instancePath+"/executionId",schemaPath:"#/properties/executionId/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/executionId",schemaPath:"#/properties/executionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern0.test(data0)){
const err4 = {instancePath:instancePath+"/executionId",schemaPath:"#/properties/executionId/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/executionId",schemaPath:"#/properties/executionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.reason !== undefined){
let data1 = data.reason;
if(typeof data1 === "string"){
if(func2(data1) > 1024){
const err6 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func2(data1) < 1){
const err7 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern0.test(data1)){
const err8 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
else {
const err10 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
validate27.errors = vErrors;
return errors === 0;
}

export const v18 = validate28;
const schema29 = {"type":"object","properties":{"executionId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"afterSequence":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":200}},"required":["executionId"],"additionalProperties":false};

function validate28(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.executionId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "executionId"},message:"must have required property '"+"executionId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "executionId") || (key0 === "afterSequence")) || (key0 === "limit"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.executionId !== undefined){
let data0 = data.executionId;
if(typeof data0 === "string"){
if(func2(data0) > 512){
const err2 = {instancePath:instancePath+"/executionId",schemaPath:"#/properties/executionId/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/executionId",schemaPath:"#/properties/executionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern0.test(data0)){
const err4 = {instancePath:instancePath+"/executionId",schemaPath:"#/properties/executionId/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/executionId",schemaPath:"#/properties/executionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.afterSequence !== undefined){
let data1 = data.afterSequence;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err6 = {instancePath:instancePath+"/afterSequence",schemaPath:"#/properties/afterSequence/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err7 = {instancePath:instancePath+"/afterSequence",schemaPath:"#/properties/afterSequence/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.limit !== undefined){
let data2 = data.limit;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err8 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 200 || isNaN(data2)){
const err9 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 200},message:"must be <= 200"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data2 < 1 || isNaN(data2)){
const err10 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate28.errors = vErrors;
return errors === 0;
}

export const v19 = validate29;
const schema30 = {"type":"object","properties":{"events":{"type":"array","items":{"type":"object","properties":{"eventId":{"type":"string","minLength":1},"executionId":{"type":"string","minLength":1},"sequence":{"type":"integer","minimum":1},"timestamp":{"type":"integer","minimum":1},"type":{"enum":["queued","running","progress","completed","failed","cancelled","interrupted"]},"tokens":{"type":"integer","minimum":0},"toolCalls":{"type":"integer","minimum":0},"lastToolName":{"type":["string","null"]},"error":{"type":"string"}},"required":["eventId","executionId","sequence","timestamp","type"],"additionalProperties":false},"maxItems":200},"earliestSequence":{"type":"integer","minimum":0}},"required":["events","earliestSequence"],"additionalProperties":false};

function validate29(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.events === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "events"},message:"must have required property '"+"events"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.earliestSequence === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "earliestSequence"},message:"must have required property '"+"earliestSequence"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "events") || (key0 === "earliestSequence"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.events !== undefined){
let data0 = data.events;
if(Array.isArray(data0)){
if(data0.length > 200){
const err3 = {instancePath:instancePath+"/events",schemaPath:"#/properties/events/maxItems",keyword:"maxItems",params:{limit: 200},message:"must NOT have more than 200 items"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.eventId === undefined){
const err4 = {instancePath:instancePath+"/events/" + i0,schemaPath:"#/properties/events/items/required",keyword:"required",params:{missingProperty: "eventId"},message:"must have required property '"+"eventId"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.executionId === undefined){
const err5 = {instancePath:instancePath+"/events/" + i0,schemaPath:"#/properties/events/items/required",keyword:"required",params:{missingProperty: "executionId"},message:"must have required property '"+"executionId"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.sequence === undefined){
const err6 = {instancePath:instancePath+"/events/" + i0,schemaPath:"#/properties/events/items/required",keyword:"required",params:{missingProperty: "sequence"},message:"must have required property '"+"sequence"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.timestamp === undefined){
const err7 = {instancePath:instancePath+"/events/" + i0,schemaPath:"#/properties/events/items/required",keyword:"required",params:{missingProperty: "timestamp"},message:"must have required property '"+"timestamp"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.type === undefined){
const err8 = {instancePath:instancePath+"/events/" + i0,schemaPath:"#/properties/events/items/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
for(const key1 in data1){
if(!(func8.call(schema30.properties.events.items.properties, key1))){
const err9 = {instancePath:instancePath+"/events/" + i0,schemaPath:"#/properties/events/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data1.eventId !== undefined){
let data2 = data1.eventId;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err10 = {instancePath:instancePath+"/events/" + i0+"/eventId",schemaPath:"#/properties/events/items/properties/eventId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/events/" + i0+"/eventId",schemaPath:"#/properties/events/items/properties/eventId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data1.executionId !== undefined){
let data3 = data1.executionId;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err12 = {instancePath:instancePath+"/events/" + i0+"/executionId",schemaPath:"#/properties/events/items/properties/executionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/events/" + i0+"/executionId",schemaPath:"#/properties/events/items/properties/executionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data1.sequence !== undefined){
let data4 = data1.sequence;
if(!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))){
const err14 = {instancePath:instancePath+"/events/" + i0+"/sequence",schemaPath:"#/properties/events/items/properties/sequence/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(typeof data4 == "number"){
if(data4 < 1 || isNaN(data4)){
const err15 = {instancePath:instancePath+"/events/" + i0+"/sequence",schemaPath:"#/properties/events/items/properties/sequence/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
if(data1.timestamp !== undefined){
let data5 = data1.timestamp;
if(!((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5)))){
const err16 = {instancePath:instancePath+"/events/" + i0+"/timestamp",schemaPath:"#/properties/events/items/properties/timestamp/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(typeof data5 == "number"){
if(data5 < 1 || isNaN(data5)){
const err17 = {instancePath:instancePath+"/events/" + i0+"/timestamp",schemaPath:"#/properties/events/items/properties/timestamp/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
if(data1.type !== undefined){
let data6 = data1.type;
if(!(((((((data6 === "queued") || (data6 === "running")) || (data6 === "progress")) || (data6 === "completed")) || (data6 === "failed")) || (data6 === "cancelled")) || (data6 === "interrupted"))){
const err18 = {instancePath:instancePath+"/events/" + i0+"/type",schemaPath:"#/properties/events/items/properties/type/enum",keyword:"enum",params:{allowedValues: schema30.properties.events.items.properties.type.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data1.tokens !== undefined){
let data7 = data1.tokens;
if(!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))){
const err19 = {instancePath:instancePath+"/events/" + i0+"/tokens",schemaPath:"#/properties/events/items/properties/tokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(typeof data7 == "number"){
if(data7 < 0 || isNaN(data7)){
const err20 = {instancePath:instancePath+"/events/" + i0+"/tokens",schemaPath:"#/properties/events/items/properties/tokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
}
if(data1.toolCalls !== undefined){
let data8 = data1.toolCalls;
if(!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))){
const err21 = {instancePath:instancePath+"/events/" + i0+"/toolCalls",schemaPath:"#/properties/events/items/properties/toolCalls/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(typeof data8 == "number"){
if(data8 < 0 || isNaN(data8)){
const err22 = {instancePath:instancePath+"/events/" + i0+"/toolCalls",schemaPath:"#/properties/events/items/properties/toolCalls/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
}
if(data1.lastToolName !== undefined){
let data9 = data1.lastToolName;
if((typeof data9 !== "string") && (data9 !== null)){
const err23 = {instancePath:instancePath+"/events/" + i0+"/lastToolName",schemaPath:"#/properties/events/items/properties/lastToolName/type",keyword:"type",params:{type: schema30.properties.events.items.properties.lastToolName.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data1.error !== undefined){
if(typeof data1.error !== "string"){
const err24 = {instancePath:instancePath+"/events/" + i0+"/error",schemaPath:"#/properties/events/items/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
else {
const err25 = {instancePath:instancePath+"/events/" + i0,schemaPath:"#/properties/events/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
}
else {
const err26 = {instancePath:instancePath+"/events",schemaPath:"#/properties/events/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.earliestSequence !== undefined){
let data11 = data.earliestSequence;
if(!((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11)))){
const err27 = {instancePath:instancePath+"/earliestSequence",schemaPath:"#/properties/earliestSequence/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(typeof data11 == "number"){
if(data11 < 0 || isNaN(data11)){
const err28 = {instancePath:instancePath+"/earliestSequence",schemaPath:"#/properties/earliestSequence/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
}
}
else {
const err29 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
validate29.errors = vErrors;
return errors === 0;
}

export const v20 = validate30;
const schema31 = {"type":"object","properties":{"resultRef":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":100000}},"required":["resultRef"],"additionalProperties":false};

function validate30(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.resultRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "resultRef"},message:"must have required property '"+"resultRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "resultRef") || (key0 === "offset")) || (key0 === "limit"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.resultRef !== undefined){
let data0 = data.resultRef;
if(typeof data0 === "string"){
if(func2(data0) > 512){
const err2 = {instancePath:instancePath+"/resultRef",schemaPath:"#/properties/resultRef/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/resultRef",schemaPath:"#/properties/resultRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern0.test(data0)){
const err4 = {instancePath:instancePath+"/resultRef",schemaPath:"#/properties/resultRef/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/resultRef",schemaPath:"#/properties/resultRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.offset !== undefined){
let data1 = data.offset;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err6 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err7 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.limit !== undefined){
let data2 = data.limit;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err8 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 100000 || isNaN(data2)){
const err9 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 100000},message:"must be <= 100000"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data2 < 1 || isNaN(data2)){
const err10 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate30.errors = vErrors;
return errors === 0;
}

export const v21 = validate31;
const schema32 = {"type":"object","properties":{"text":{"type":"string","maxLength":100000},"nextOffset":{"anyOf":[{"type":"integer","minimum":0},{"type":"null"}]}},"required":["text","nextOffset"],"additionalProperties":false};

function validate31(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.text === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.nextOffset === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "nextOffset"},message:"must have required property '"+"nextOffset"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "text") || (key0 === "nextOffset"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.text !== undefined){
let data0 = data.text;
if(typeof data0 === "string"){
if(func2(data0) > 100000){
const err3 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/maxLength",keyword:"maxLength",params:{limit: 100000},message:"must NOT have more than 100000 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.nextOffset !== undefined){
let data1 = data.nextOffset;
const _errs5 = errors;
let valid1 = false;
const _errs6 = errors;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err5 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
var _valid0 = _errs6 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs8 = errors;
if(data1 !== null){
const err7 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
var _valid0 = _errs8 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err8 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
else {
errors = _errs5;
if(vErrors !== null){
if(_errs5){
vErrors.length = _errs5;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate31.errors = vErrors;
return errors === 0;
}

export const v22 = validate32;
const schema33 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1},"execution":{"type":"object","properties":{"id":{"type":"string","minLength":1},"key":{"type":"string","minLength":1},"taskId":{"type":"string","minLength":1},"contextKey":{"type":"string","minLength":1},"contextRef":{"type":"string","minLength":1},"status":{"enum":["queued","running","completed","failed","cancelled","interrupted"]},"sequence":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"toolCalls":{"type":"integer","minimum":0},"createdAt":{"type":"integer","minimum":1},"attempt":{"type":"integer","minimum":1},"resultRef":{"type":"string","minLength":1},"error":{"type":"string"}},"required":["id","key","taskId","contextKey","contextRef","status","sequence","tokens","toolCalls","createdAt","attempt"],"additionalProperties":false},"event":{"type":"object","properties":{"eventId":{"type":"string","minLength":1},"executionId":{"type":"string","minLength":1},"sequence":{"type":"integer","minimum":1},"timestamp":{"type":"integer","minimum":1},"type":{"enum":["queued","running","progress","completed","failed","cancelled","interrupted"]},"tokens":{"type":"integer","minimum":0},"toolCalls":{"type":"integer","minimum":0},"lastToolName":{"type":["string","null"]},"error":{"type":"string"}},"required":["eventId","executionId","sequence","timestamp","type"],"additionalProperties":false}},"required":["taskId","execution","event"],"additionalProperties":false};

function validate32(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.taskId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "taskId"},message:"must have required property '"+"taskId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.execution === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "execution"},message:"must have required property '"+"execution"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.event === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "event"},message:"must have required property '"+"event"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "taskId") || (key0 === "execution")) || (key0 === "event"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.taskId !== undefined){
let data0 = data.taskId;
if(typeof data0 === "string"){
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/taskId",schemaPath:"#/properties/taskId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.execution !== undefined){
let data1 = data.execution;
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.id === undefined){
const err6 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.key === undefined){
const err7 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.taskId === undefined){
const err8 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/required",keyword:"required",params:{missingProperty: "taskId"},message:"must have required property '"+"taskId"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1.contextKey === undefined){
const err9 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/required",keyword:"required",params:{missingProperty: "contextKey"},message:"must have required property '"+"contextKey"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data1.contextRef === undefined){
const err10 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/required",keyword:"required",params:{missingProperty: "contextRef"},message:"must have required property '"+"contextRef"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data1.status === undefined){
const err11 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data1.sequence === undefined){
const err12 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/required",keyword:"required",params:{missingProperty: "sequence"},message:"must have required property '"+"sequence"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data1.tokens === undefined){
const err13 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/required",keyword:"required",params:{missingProperty: "tokens"},message:"must have required property '"+"tokens"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data1.toolCalls === undefined){
const err14 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/required",keyword:"required",params:{missingProperty: "toolCalls"},message:"must have required property '"+"toolCalls"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data1.createdAt === undefined){
const err15 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data1.attempt === undefined){
const err16 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/required",keyword:"required",params:{missingProperty: "attempt"},message:"must have required property '"+"attempt"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
for(const key1 in data1){
if(!(func8.call(schema33.properties.execution.properties, key1))){
const err17 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data1.id !== undefined){
let data2 = data1.id;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err18 = {instancePath:instancePath+"/execution/id",schemaPath:"#/properties/execution/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/execution/id",schemaPath:"#/properties/execution/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data1.key !== undefined){
let data3 = data1.key;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err20 = {instancePath:instancePath+"/execution/key",schemaPath:"#/properties/execution/properties/key/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/execution/key",schemaPath:"#/properties/execution/properties/key/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data1.taskId !== undefined){
let data4 = data1.taskId;
if(typeof data4 === "string"){
if(func2(data4) < 1){
const err22 = {instancePath:instancePath+"/execution/taskId",schemaPath:"#/properties/execution/properties/taskId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
else {
const err23 = {instancePath:instancePath+"/execution/taskId",schemaPath:"#/properties/execution/properties/taskId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data1.contextKey !== undefined){
let data5 = data1.contextKey;
if(typeof data5 === "string"){
if(func2(data5) < 1){
const err24 = {instancePath:instancePath+"/execution/contextKey",schemaPath:"#/properties/execution/properties/contextKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/execution/contextKey",schemaPath:"#/properties/execution/properties/contextKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data1.contextRef !== undefined){
let data6 = data1.contextRef;
if(typeof data6 === "string"){
if(func2(data6) < 1){
const err26 = {instancePath:instancePath+"/execution/contextRef",schemaPath:"#/properties/execution/properties/contextRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
else {
const err27 = {instancePath:instancePath+"/execution/contextRef",schemaPath:"#/properties/execution/properties/contextRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data1.status !== undefined){
let data7 = data1.status;
if(!((((((data7 === "queued") || (data7 === "running")) || (data7 === "completed")) || (data7 === "failed")) || (data7 === "cancelled")) || (data7 === "interrupted"))){
const err28 = {instancePath:instancePath+"/execution/status",schemaPath:"#/properties/execution/properties/status/enum",keyword:"enum",params:{allowedValues: schema33.properties.execution.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data1.sequence !== undefined){
let data8 = data1.sequence;
if(!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))){
const err29 = {instancePath:instancePath+"/execution/sequence",schemaPath:"#/properties/execution/properties/sequence/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(typeof data8 == "number"){
if(data8 < 0 || isNaN(data8)){
const err30 = {instancePath:instancePath+"/execution/sequence",schemaPath:"#/properties/execution/properties/sequence/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
}
if(data1.tokens !== undefined){
let data9 = data1.tokens;
if(!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))){
const err31 = {instancePath:instancePath+"/execution/tokens",schemaPath:"#/properties/execution/properties/tokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(typeof data9 == "number"){
if(data9 < 0 || isNaN(data9)){
const err32 = {instancePath:instancePath+"/execution/tokens",schemaPath:"#/properties/execution/properties/tokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
}
if(data1.toolCalls !== undefined){
let data10 = data1.toolCalls;
if(!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))){
const err33 = {instancePath:instancePath+"/execution/toolCalls",schemaPath:"#/properties/execution/properties/toolCalls/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(typeof data10 == "number"){
if(data10 < 0 || isNaN(data10)){
const err34 = {instancePath:instancePath+"/execution/toolCalls",schemaPath:"#/properties/execution/properties/toolCalls/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
}
if(data1.createdAt !== undefined){
let data11 = data1.createdAt;
if(!((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11)))){
const err35 = {instancePath:instancePath+"/execution/createdAt",schemaPath:"#/properties/execution/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(typeof data11 == "number"){
if(data11 < 1 || isNaN(data11)){
const err36 = {instancePath:instancePath+"/execution/createdAt",schemaPath:"#/properties/execution/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
if(data1.attempt !== undefined){
let data12 = data1.attempt;
if(!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))){
const err37 = {instancePath:instancePath+"/execution/attempt",schemaPath:"#/properties/execution/properties/attempt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(typeof data12 == "number"){
if(data12 < 1 || isNaN(data12)){
const err38 = {instancePath:instancePath+"/execution/attempt",schemaPath:"#/properties/execution/properties/attempt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
}
if(data1.resultRef !== undefined){
let data13 = data1.resultRef;
if(typeof data13 === "string"){
if(func2(data13) < 1){
const err39 = {instancePath:instancePath+"/execution/resultRef",schemaPath:"#/properties/execution/properties/resultRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
else {
const err40 = {instancePath:instancePath+"/execution/resultRef",schemaPath:"#/properties/execution/properties/resultRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
if(data1.error !== undefined){
if(typeof data1.error !== "string"){
const err41 = {instancePath:instancePath+"/execution/error",schemaPath:"#/properties/execution/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
}
else {
const err42 = {instancePath:instancePath+"/execution",schemaPath:"#/properties/execution/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
if(data.event !== undefined){
let data15 = data.event;
if(data15 && typeof data15 == "object" && !Array.isArray(data15)){
if(data15.eventId === undefined){
const err43 = {instancePath:instancePath+"/event",schemaPath:"#/properties/event/required",keyword:"required",params:{missingProperty: "eventId"},message:"must have required property '"+"eventId"+"'"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if(data15.executionId === undefined){
const err44 = {instancePath:instancePath+"/event",schemaPath:"#/properties/event/required",keyword:"required",params:{missingProperty: "executionId"},message:"must have required property '"+"executionId"+"'"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
if(data15.sequence === undefined){
const err45 = {instancePath:instancePath+"/event",schemaPath:"#/properties/event/required",keyword:"required",params:{missingProperty: "sequence"},message:"must have required property '"+"sequence"+"'"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if(data15.timestamp === undefined){
const err46 = {instancePath:instancePath+"/event",schemaPath:"#/properties/event/required",keyword:"required",params:{missingProperty: "timestamp"},message:"must have required property '"+"timestamp"+"'"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if(data15.type === undefined){
const err47 = {instancePath:instancePath+"/event",schemaPath:"#/properties/event/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
for(const key2 in data15){
if(!(func8.call(schema33.properties.event.properties, key2))){
const err48 = {instancePath:instancePath+"/event",schemaPath:"#/properties/event/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
if(data15.eventId !== undefined){
let data16 = data15.eventId;
if(typeof data16 === "string"){
if(func2(data16) < 1){
const err49 = {instancePath:instancePath+"/event/eventId",schemaPath:"#/properties/event/properties/eventId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
else {
const err50 = {instancePath:instancePath+"/event/eventId",schemaPath:"#/properties/event/properties/eventId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
if(data15.executionId !== undefined){
let data17 = data15.executionId;
if(typeof data17 === "string"){
if(func2(data17) < 1){
const err51 = {instancePath:instancePath+"/event/executionId",schemaPath:"#/properties/event/properties/executionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
else {
const err52 = {instancePath:instancePath+"/event/executionId",schemaPath:"#/properties/event/properties/executionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
if(data15.sequence !== undefined){
let data18 = data15.sequence;
if(!((typeof data18 == "number") && (!(data18 % 1) && !isNaN(data18)))){
const err53 = {instancePath:instancePath+"/event/sequence",schemaPath:"#/properties/event/properties/sequence/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
if(typeof data18 == "number"){
if(data18 < 1 || isNaN(data18)){
const err54 = {instancePath:instancePath+"/event/sequence",schemaPath:"#/properties/event/properties/sequence/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
}
if(data15.timestamp !== undefined){
let data19 = data15.timestamp;
if(!((typeof data19 == "number") && (!(data19 % 1) && !isNaN(data19)))){
const err55 = {instancePath:instancePath+"/event/timestamp",schemaPath:"#/properties/event/properties/timestamp/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
if(typeof data19 == "number"){
if(data19 < 1 || isNaN(data19)){
const err56 = {instancePath:instancePath+"/event/timestamp",schemaPath:"#/properties/event/properties/timestamp/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
}
}
if(data15.type !== undefined){
let data20 = data15.type;
if(!(((((((data20 === "queued") || (data20 === "running")) || (data20 === "progress")) || (data20 === "completed")) || (data20 === "failed")) || (data20 === "cancelled")) || (data20 === "interrupted"))){
const err57 = {instancePath:instancePath+"/event/type",schemaPath:"#/properties/event/properties/type/enum",keyword:"enum",params:{allowedValues: schema33.properties.event.properties.type.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
}
if(data15.tokens !== undefined){
let data21 = data15.tokens;
if(!((typeof data21 == "number") && (!(data21 % 1) && !isNaN(data21)))){
const err58 = {instancePath:instancePath+"/event/tokens",schemaPath:"#/properties/event/properties/tokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
if(typeof data21 == "number"){
if(data21 < 0 || isNaN(data21)){
const err59 = {instancePath:instancePath+"/event/tokens",schemaPath:"#/properties/event/properties/tokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
}
}
if(data15.toolCalls !== undefined){
let data22 = data15.toolCalls;
if(!((typeof data22 == "number") && (!(data22 % 1) && !isNaN(data22)))){
const err60 = {instancePath:instancePath+"/event/toolCalls",schemaPath:"#/properties/event/properties/toolCalls/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
if(typeof data22 == "number"){
if(data22 < 0 || isNaN(data22)){
const err61 = {instancePath:instancePath+"/event/toolCalls",schemaPath:"#/properties/event/properties/toolCalls/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
}
}
if(data15.lastToolName !== undefined){
let data23 = data15.lastToolName;
if((typeof data23 !== "string") && (data23 !== null)){
const err62 = {instancePath:instancePath+"/event/lastToolName",schemaPath:"#/properties/event/properties/lastToolName/type",keyword:"type",params:{type: schema33.properties.event.properties.lastToolName.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
}
if(data15.error !== undefined){
if(typeof data15.error !== "string"){
const err63 = {instancePath:instancePath+"/event/error",schemaPath:"#/properties/event/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
}
}
else {
const err64 = {instancePath:instancePath+"/event",schemaPath:"#/properties/event/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
}
}
else {
const err65 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
validate32.errors = vErrors;
return errors === 0;
}

export const v23 = validate33;
const schema34 = {"type":"object","properties":{},"required":[],"additionalProperties":false};

function validate33(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
const err0 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate33.errors = vErrors;
return errors === 0;
}

export const v24 = validate34;
const schema35 = {"type":"object","properties":{"servers":{"type":"array","maxItems":100,"items":{"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"},"enabled":{"type":"boolean"},"config":{"type":"object","properties":{"type":{"enum":["stdio","http","sse"]},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"env":{"type":"object","additionalProperties":{"type":"string"}},"url":{"type":"string"},"headers":{"type":"object","additionalProperties":{"type":"string"}},"disabledTools":{"type":"array","items":{"type":"string"}},"oauth":{"type":"object","properties":{"clientName":{"type":"string"},"clientId":{"type":"string"},"redirectUri":{"type":"string"},"authorizationServerOrigin":{"type":"string"},"resourceMetadataUrl":{"type":"string"},"authServerMetadataUrl":{"type":"string"},"callbackPort":{"type":"integer","minimum":1,"maximum":65535},"omitRegistrationScope":{"type":"boolean"},"xaa":{"type":"boolean"}},"required":[],"additionalProperties":false}},"required":["type"],"additionalProperties":false},"updatedAt":{"type":"integer","minimum":0},"credentialsMissing":{"type":"boolean"},"check":{"anyOf":[{"type":"object","properties":{"state":{"enum":["connected","needs-auth","authorized","unchecked","failed"]},"tools":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"description":{"type":"string"},"disabled":{"type":"boolean"}},"required":["name","description","disabled"],"additionalProperties":false}},"checkedAt":{"type":"integer","minimum":0},"durationMs":{"type":"number","minimum":0},"truncated":{"type":"boolean"},"error":{"type":"string"},"serverInfo":{"type":"object","properties":{"name":{"type":"string"},"version":{"type":"string"}},"required":["name","version"],"additionalProperties":false}},"required":["state","tools","checkedAt"],"additionalProperties":false},{"type":"null"}]}},"required":["name","enabled","config","updatedAt","credentialsMissing","check"],"additionalProperties":false}},"resetSessionCount":{"type":"integer","minimum":0},"skippedBusySessionCount":{"type":"integer","minimum":0}},"required":["servers"],"additionalProperties":false};
const pattern23 = new RegExp("^[a-zA-Z0-9_-]+$", "u");

function validate34(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.servers === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "servers"},message:"must have required property '"+"servers"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "servers") || (key0 === "resetSessionCount")) || (key0 === "skippedBusySessionCount"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.servers !== undefined){
let data0 = data.servers;
if(Array.isArray(data0)){
if(data0.length > 100){
const err2 = {instancePath:instancePath+"/servers",schemaPath:"#/properties/servers/maxItems",keyword:"maxItems",params:{limit: 100},message:"must NOT have more than 100 items"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.name === undefined){
const err3 = {instancePath:instancePath+"/servers/" + i0,schemaPath:"#/properties/servers/items/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data1.enabled === undefined){
const err4 = {instancePath:instancePath+"/servers/" + i0,schemaPath:"#/properties/servers/items/required",keyword:"required",params:{missingProperty: "enabled"},message:"must have required property '"+"enabled"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.config === undefined){
const err5 = {instancePath:instancePath+"/servers/" + i0,schemaPath:"#/properties/servers/items/required",keyword:"required",params:{missingProperty: "config"},message:"must have required property '"+"config"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.updatedAt === undefined){
const err6 = {instancePath:instancePath+"/servers/" + i0,schemaPath:"#/properties/servers/items/required",keyword:"required",params:{missingProperty: "updatedAt"},message:"must have required property '"+"updatedAt"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.credentialsMissing === undefined){
const err7 = {instancePath:instancePath+"/servers/" + i0,schemaPath:"#/properties/servers/items/required",keyword:"required",params:{missingProperty: "credentialsMissing"},message:"must have required property '"+"credentialsMissing"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.check === undefined){
const err8 = {instancePath:instancePath+"/servers/" + i0,schemaPath:"#/properties/servers/items/required",keyword:"required",params:{missingProperty: "check"},message:"must have required property '"+"check"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
for(const key1 in data1){
if(!((((((key1 === "name") || (key1 === "enabled")) || (key1 === "config")) || (key1 === "updatedAt")) || (key1 === "credentialsMissing")) || (key1 === "check"))){
const err9 = {instancePath:instancePath+"/servers/" + i0,schemaPath:"#/properties/servers/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data1.name !== undefined){
let data2 = data1.name;
if(typeof data2 === "string"){
if(func2(data2) > 64){
const err10 = {instancePath:instancePath+"/servers/" + i0+"/name",schemaPath:"#/properties/servers/items/properties/name/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func2(data2) < 1){
const err11 = {instancePath:instancePath+"/servers/" + i0+"/name",schemaPath:"#/properties/servers/items/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!pattern23.test(data2)){
const err12 = {instancePath:instancePath+"/servers/" + i0+"/name",schemaPath:"#/properties/servers/items/properties/name/pattern",keyword:"pattern",params:{pattern: "^[a-zA-Z0-9_-]+$"},message:"must match pattern \""+"^[a-zA-Z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/servers/" + i0+"/name",schemaPath:"#/properties/servers/items/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data1.enabled !== undefined){
if(typeof data1.enabled !== "boolean"){
const err14 = {instancePath:instancePath+"/servers/" + i0+"/enabled",schemaPath:"#/properties/servers/items/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data1.config !== undefined){
let data4 = data1.config;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.type === undefined){
const err15 = {instancePath:instancePath+"/servers/" + i0+"/config",schemaPath:"#/properties/servers/items/properties/config/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
for(const key2 in data4){
if(!((((((((key2 === "type") || (key2 === "command")) || (key2 === "args")) || (key2 === "env")) || (key2 === "url")) || (key2 === "headers")) || (key2 === "disabledTools")) || (key2 === "oauth"))){
const err16 = {instancePath:instancePath+"/servers/" + i0+"/config",schemaPath:"#/properties/servers/items/properties/config/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data4.type !== undefined){
let data5 = data4.type;
if(!(((data5 === "stdio") || (data5 === "http")) || (data5 === "sse"))){
const err17 = {instancePath:instancePath+"/servers/" + i0+"/config/type",schemaPath:"#/properties/servers/items/properties/config/properties/type/enum",keyword:"enum",params:{allowedValues: schema35.properties.servers.items.properties.config.properties.type.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data4.command !== undefined){
if(typeof data4.command !== "string"){
const err18 = {instancePath:instancePath+"/servers/" + i0+"/config/command",schemaPath:"#/properties/servers/items/properties/config/properties/command/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data4.args !== undefined){
let data7 = data4.args;
if(Array.isArray(data7)){
const len1 = data7.length;
for(let i1=0; i1<len1; i1++){
if(typeof data7[i1] !== "string"){
const err19 = {instancePath:instancePath+"/servers/" + i0+"/config/args/" + i1,schemaPath:"#/properties/servers/items/properties/config/properties/args/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
}
else {
const err20 = {instancePath:instancePath+"/servers/" + i0+"/config/args",schemaPath:"#/properties/servers/items/properties/config/properties/args/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data4.env !== undefined){
let data9 = data4.env;
if(data9 && typeof data9 == "object" && !Array.isArray(data9)){
for(const key3 in data9){
if(typeof data9[key3] !== "string"){
const err21 = {instancePath:instancePath+"/servers/" + i0+"/config/env/" + key3.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/servers/items/properties/config/properties/env/additionalProperties/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
else {
const err22 = {instancePath:instancePath+"/servers/" + i0+"/config/env",schemaPath:"#/properties/servers/items/properties/config/properties/env/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data4.url !== undefined){
if(typeof data4.url !== "string"){
const err23 = {instancePath:instancePath+"/servers/" + i0+"/config/url",schemaPath:"#/properties/servers/items/properties/config/properties/url/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data4.headers !== undefined){
let data12 = data4.headers;
if(data12 && typeof data12 == "object" && !Array.isArray(data12)){
for(const key4 in data12){
if(typeof data12[key4] !== "string"){
const err24 = {instancePath:instancePath+"/servers/" + i0+"/config/headers/" + key4.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/servers/items/properties/config/properties/headers/additionalProperties/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
else {
const err25 = {instancePath:instancePath+"/servers/" + i0+"/config/headers",schemaPath:"#/properties/servers/items/properties/config/properties/headers/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data4.disabledTools !== undefined){
let data14 = data4.disabledTools;
if(Array.isArray(data14)){
const len2 = data14.length;
for(let i2=0; i2<len2; i2++){
if(typeof data14[i2] !== "string"){
const err26 = {instancePath:instancePath+"/servers/" + i0+"/config/disabledTools/" + i2,schemaPath:"#/properties/servers/items/properties/config/properties/disabledTools/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
else {
const err27 = {instancePath:instancePath+"/servers/" + i0+"/config/disabledTools",schemaPath:"#/properties/servers/items/properties/config/properties/disabledTools/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data4.oauth !== undefined){
let data16 = data4.oauth;
if(data16 && typeof data16 == "object" && !Array.isArray(data16)){
for(const key5 in data16){
if(!(func8.call(schema35.properties.servers.items.properties.config.properties.oauth.properties, key5))){
const err28 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key5},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data16.clientName !== undefined){
if(typeof data16.clientName !== "string"){
const err29 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth/clientName",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/properties/clientName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data16.clientId !== undefined){
if(typeof data16.clientId !== "string"){
const err30 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth/clientId",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/properties/clientId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data16.redirectUri !== undefined){
if(typeof data16.redirectUri !== "string"){
const err31 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth/redirectUri",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/properties/redirectUri/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data16.authorizationServerOrigin !== undefined){
if(typeof data16.authorizationServerOrigin !== "string"){
const err32 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth/authorizationServerOrigin",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/properties/authorizationServerOrigin/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
if(data16.resourceMetadataUrl !== undefined){
if(typeof data16.resourceMetadataUrl !== "string"){
const err33 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth/resourceMetadataUrl",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/properties/resourceMetadataUrl/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data16.authServerMetadataUrl !== undefined){
if(typeof data16.authServerMetadataUrl !== "string"){
const err34 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth/authServerMetadataUrl",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/properties/authServerMetadataUrl/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
if(data16.callbackPort !== undefined){
let data23 = data16.callbackPort;
if(!((typeof data23 == "number") && (!(data23 % 1) && !isNaN(data23)))){
const err35 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth/callbackPort",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/properties/callbackPort/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(typeof data23 == "number"){
if(data23 > 65535 || isNaN(data23)){
const err36 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth/callbackPort",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/properties/callbackPort/maximum",keyword:"maximum",params:{comparison: "<=", limit: 65535},message:"must be <= 65535"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(data23 < 1 || isNaN(data23)){
const err37 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth/callbackPort",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/properties/callbackPort/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
}
if(data16.omitRegistrationScope !== undefined){
if(typeof data16.omitRegistrationScope !== "boolean"){
const err38 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth/omitRegistrationScope",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/properties/omitRegistrationScope/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
if(data16.xaa !== undefined){
if(typeof data16.xaa !== "boolean"){
const err39 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth/xaa",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/properties/xaa/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
}
else {
const err40 = {instancePath:instancePath+"/servers/" + i0+"/config/oauth",schemaPath:"#/properties/servers/items/properties/config/properties/oauth/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
}
else {
const err41 = {instancePath:instancePath+"/servers/" + i0+"/config",schemaPath:"#/properties/servers/items/properties/config/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
if(data1.updatedAt !== undefined){
let data26 = data1.updatedAt;
if(!((typeof data26 == "number") && (!(data26 % 1) && !isNaN(data26)))){
const err42 = {instancePath:instancePath+"/servers/" + i0+"/updatedAt",schemaPath:"#/properties/servers/items/properties/updatedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(typeof data26 == "number"){
if(data26 < 0 || isNaN(data26)){
const err43 = {instancePath:instancePath+"/servers/" + i0+"/updatedAt",schemaPath:"#/properties/servers/items/properties/updatedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
}
if(data1.credentialsMissing !== undefined){
if(typeof data1.credentialsMissing !== "boolean"){
const err44 = {instancePath:instancePath+"/servers/" + i0+"/credentialsMissing",schemaPath:"#/properties/servers/items/properties/credentialsMissing/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
if(data1.check !== undefined){
let data28 = data1.check;
const _errs63 = errors;
let valid12 = false;
const _errs64 = errors;
if(data28 && typeof data28 == "object" && !Array.isArray(data28)){
if(data28.state === undefined){
const err45 = {instancePath:instancePath+"/servers/" + i0+"/check",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if(data28.tools === undefined){
const err46 = {instancePath:instancePath+"/servers/" + i0+"/check",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/required",keyword:"required",params:{missingProperty: "tools"},message:"must have required property '"+"tools"+"'"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if(data28.checkedAt === undefined){
const err47 = {instancePath:instancePath+"/servers/" + i0+"/check",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/required",keyword:"required",params:{missingProperty: "checkedAt"},message:"must have required property '"+"checkedAt"+"'"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
for(const key6 in data28){
if(!(((((((key6 === "state") || (key6 === "tools")) || (key6 === "checkedAt")) || (key6 === "durationMs")) || (key6 === "truncated")) || (key6 === "error")) || (key6 === "serverInfo"))){
const err48 = {instancePath:instancePath+"/servers/" + i0+"/check",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key6},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
if(data28.state !== undefined){
let data29 = data28.state;
if(!(((((data29 === "connected") || (data29 === "needs-auth")) || (data29 === "authorized")) || (data29 === "unchecked")) || (data29 === "failed"))){
const err49 = {instancePath:instancePath+"/servers/" + i0+"/check/state",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/state/enum",keyword:"enum",params:{allowedValues: schema35.properties.servers.items.properties.check.anyOf[0].properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data28.tools !== undefined){
let data30 = data28.tools;
if(Array.isArray(data30)){
const len3 = data30.length;
for(let i3=0; i3<len3; i3++){
let data31 = data30[i3];
if(data31 && typeof data31 == "object" && !Array.isArray(data31)){
if(data31.name === undefined){
const err50 = {instancePath:instancePath+"/servers/" + i0+"/check/tools/" + i3,schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/tools/items/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
if(data31.description === undefined){
const err51 = {instancePath:instancePath+"/servers/" + i0+"/check/tools/" + i3,schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/tools/items/required",keyword:"required",params:{missingProperty: "description"},message:"must have required property '"+"description"+"'"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
if(data31.disabled === undefined){
const err52 = {instancePath:instancePath+"/servers/" + i0+"/check/tools/" + i3,schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/tools/items/required",keyword:"required",params:{missingProperty: "disabled"},message:"must have required property '"+"disabled"+"'"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
for(const key7 in data31){
if(!(((key7 === "name") || (key7 === "description")) || (key7 === "disabled"))){
const err53 = {instancePath:instancePath+"/servers/" + i0+"/check/tools/" + i3,schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/tools/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key7},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
if(data31.name !== undefined){
if(typeof data31.name !== "string"){
const err54 = {instancePath:instancePath+"/servers/" + i0+"/check/tools/" + i3+"/name",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/tools/items/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
if(data31.description !== undefined){
if(typeof data31.description !== "string"){
const err55 = {instancePath:instancePath+"/servers/" + i0+"/check/tools/" + i3+"/description",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/tools/items/properties/description/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
if(data31.disabled !== undefined){
if(typeof data31.disabled !== "boolean"){
const err56 = {instancePath:instancePath+"/servers/" + i0+"/check/tools/" + i3+"/disabled",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/tools/items/properties/disabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
}
}
else {
const err57 = {instancePath:instancePath+"/servers/" + i0+"/check/tools/" + i3,schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/tools/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
}
}
else {
const err58 = {instancePath:instancePath+"/servers/" + i0+"/check/tools",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/tools/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
}
if(data28.checkedAt !== undefined){
let data35 = data28.checkedAt;
if(!((typeof data35 == "number") && (!(data35 % 1) && !isNaN(data35)))){
const err59 = {instancePath:instancePath+"/servers/" + i0+"/check/checkedAt",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/checkedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
if(typeof data35 == "number"){
if(data35 < 0 || isNaN(data35)){
const err60 = {instancePath:instancePath+"/servers/" + i0+"/check/checkedAt",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/checkedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
}
}
if(data28.durationMs !== undefined){
let data36 = data28.durationMs;
if(typeof data36 == "number"){
if(data36 < 0 || isNaN(data36)){
const err61 = {instancePath:instancePath+"/servers/" + i0+"/check/durationMs",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/durationMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
}
else {
const err62 = {instancePath:instancePath+"/servers/" + i0+"/check/durationMs",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/durationMs/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
}
if(data28.truncated !== undefined){
if(typeof data28.truncated !== "boolean"){
const err63 = {instancePath:instancePath+"/servers/" + i0+"/check/truncated",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/truncated/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
}
if(data28.error !== undefined){
if(typeof data28.error !== "string"){
const err64 = {instancePath:instancePath+"/servers/" + i0+"/check/error",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
}
if(data28.serverInfo !== undefined){
let data39 = data28.serverInfo;
if(data39 && typeof data39 == "object" && !Array.isArray(data39)){
if(data39.name === undefined){
const err65 = {instancePath:instancePath+"/servers/" + i0+"/check/serverInfo",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/serverInfo/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
if(data39.version === undefined){
const err66 = {instancePath:instancePath+"/servers/" + i0+"/check/serverInfo",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/serverInfo/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
for(const key8 in data39){
if(!((key8 === "name") || (key8 === "version"))){
const err67 = {instancePath:instancePath+"/servers/" + i0+"/check/serverInfo",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/serverInfo/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key8},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
}
if(data39.name !== undefined){
if(typeof data39.name !== "string"){
const err68 = {instancePath:instancePath+"/servers/" + i0+"/check/serverInfo/name",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/serverInfo/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
}
if(data39.version !== undefined){
if(typeof data39.version !== "string"){
const err69 = {instancePath:instancePath+"/servers/" + i0+"/check/serverInfo/version",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/serverInfo/properties/version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
}
}
else {
const err70 = {instancePath:instancePath+"/servers/" + i0+"/check/serverInfo",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/serverInfo/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
}
}
else {
const err71 = {instancePath:instancePath+"/servers/" + i0+"/check",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
var _valid0 = _errs64 === errors;
valid12 = valid12 || _valid0;
if(!valid12){
const _errs94 = errors;
if(data28 !== null){
const err72 = {instancePath:instancePath+"/servers/" + i0+"/check",schemaPath:"#/properties/servers/items/properties/check/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
var _valid0 = _errs94 === errors;
valid12 = valid12 || _valid0;
}
if(!valid12){
const err73 = {instancePath:instancePath+"/servers/" + i0+"/check",schemaPath:"#/properties/servers/items/properties/check/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
else {
errors = _errs63;
if(vErrors !== null){
if(_errs63){
vErrors.length = _errs63;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err74 = {instancePath:instancePath+"/servers/" + i0,schemaPath:"#/properties/servers/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
}
}
else {
const err75 = {instancePath:instancePath+"/servers",schemaPath:"#/properties/servers/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
}
if(data.resetSessionCount !== undefined){
let data42 = data.resetSessionCount;
if(!((typeof data42 == "number") && (!(data42 % 1) && !isNaN(data42)))){
const err76 = {instancePath:instancePath+"/resetSessionCount",schemaPath:"#/properties/resetSessionCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
if(typeof data42 == "number"){
if(data42 < 0 || isNaN(data42)){
const err77 = {instancePath:instancePath+"/resetSessionCount",schemaPath:"#/properties/resetSessionCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
}
}
if(data.skippedBusySessionCount !== undefined){
let data43 = data.skippedBusySessionCount;
if(!((typeof data43 == "number") && (!(data43 % 1) && !isNaN(data43)))){
const err78 = {instancePath:instancePath+"/skippedBusySessionCount",schemaPath:"#/properties/skippedBusySessionCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
if(typeof data43 == "number"){
if(data43 < 0 || isNaN(data43)){
const err79 = {instancePath:instancePath+"/skippedBusySessionCount",schemaPath:"#/properties/skippedBusySessionCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
}
}
}
else {
const err80 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
validate34.errors = vErrors;
return errors === 0;
}

export const v25 = validate35;
const schema36 = {"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"},"previousName":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"},"enabled":{"type":"boolean"},"config":{"type":"object","properties":{"type":{"enum":["stdio","http","sse"]},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"env":{"type":"object","additionalProperties":{"type":"string"}},"url":{"type":"string"},"headers":{"type":"object","additionalProperties":{"type":"string"}},"disabledTools":{"type":"array","items":{"type":"string"}},"oauth":{"type":"object","properties":{"clientName":{"type":"string"},"clientId":{"type":"string"},"redirectUri":{"type":"string"},"authorizationServerOrigin":{"type":"string"},"resourceMetadataUrl":{"type":"string"},"authServerMetadataUrl":{"type":"string"},"callbackPort":{"type":"integer","minimum":1,"maximum":65535},"omitRegistrationScope":{"type":"boolean"},"xaa":{"type":"boolean"}},"required":[],"additionalProperties":false}},"required":[],"additionalProperties":false}},"required":["name","enabled","config"],"additionalProperties":false};

function validate35(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.name === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.enabled === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "enabled"},message:"must have required property '"+"enabled"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.config === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "config"},message:"must have required property '"+"config"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "name") || (key0 === "previousName")) || (key0 === "enabled")) || (key0 === "config"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.name !== undefined){
let data0 = data.name;
if(typeof data0 === "string"){
if(func2(data0) > 64){
const err4 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func2(data0) < 1){
const err5 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern23.test(data0)){
const err6 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[a-zA-Z0-9_-]+$"},message:"must match pattern \""+"^[a-zA-Z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.previousName !== undefined){
let data1 = data.previousName;
if(typeof data1 === "string"){
if(func2(data1) > 64){
const err8 = {instancePath:instancePath+"/previousName",schemaPath:"#/properties/previousName/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func2(data1) < 1){
const err9 = {instancePath:instancePath+"/previousName",schemaPath:"#/properties/previousName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern23.test(data1)){
const err10 = {instancePath:instancePath+"/previousName",schemaPath:"#/properties/previousName/pattern",keyword:"pattern",params:{pattern: "^[a-zA-Z0-9_-]+$"},message:"must match pattern \""+"^[a-zA-Z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/previousName",schemaPath:"#/properties/previousName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.enabled !== undefined){
if(typeof data.enabled !== "boolean"){
const err12 = {instancePath:instancePath+"/enabled",schemaPath:"#/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.config !== undefined){
let data3 = data.config;
if(data3 && typeof data3 == "object" && !Array.isArray(data3)){
for(const key1 in data3){
if(!((((((((key1 === "type") || (key1 === "command")) || (key1 === "args")) || (key1 === "env")) || (key1 === "url")) || (key1 === "headers")) || (key1 === "disabledTools")) || (key1 === "oauth"))){
const err13 = {instancePath:instancePath+"/config",schemaPath:"#/properties/config/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data3.type !== undefined){
let data4 = data3.type;
if(!(((data4 === "stdio") || (data4 === "http")) || (data4 === "sse"))){
const err14 = {instancePath:instancePath+"/config/type",schemaPath:"#/properties/config/properties/type/enum",keyword:"enum",params:{allowedValues: schema36.properties.config.properties.type.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data3.command !== undefined){
if(typeof data3.command !== "string"){
const err15 = {instancePath:instancePath+"/config/command",schemaPath:"#/properties/config/properties/command/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data3.args !== undefined){
let data6 = data3.args;
if(Array.isArray(data6)){
const len0 = data6.length;
for(let i0=0; i0<len0; i0++){
if(typeof data6[i0] !== "string"){
const err16 = {instancePath:instancePath+"/config/args/" + i0,schemaPath:"#/properties/config/properties/args/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
else {
const err17 = {instancePath:instancePath+"/config/args",schemaPath:"#/properties/config/properties/args/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data3.env !== undefined){
let data8 = data3.env;
if(data8 && typeof data8 == "object" && !Array.isArray(data8)){
for(const key2 in data8){
if(typeof data8[key2] !== "string"){
const err18 = {instancePath:instancePath+"/config/env/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/config/properties/env/additionalProperties/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
else {
const err19 = {instancePath:instancePath+"/config/env",schemaPath:"#/properties/config/properties/env/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data3.url !== undefined){
if(typeof data3.url !== "string"){
const err20 = {instancePath:instancePath+"/config/url",schemaPath:"#/properties/config/properties/url/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data3.headers !== undefined){
let data11 = data3.headers;
if(data11 && typeof data11 == "object" && !Array.isArray(data11)){
for(const key3 in data11){
if(typeof data11[key3] !== "string"){
const err21 = {instancePath:instancePath+"/config/headers/" + key3.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/config/properties/headers/additionalProperties/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
else {
const err22 = {instancePath:instancePath+"/config/headers",schemaPath:"#/properties/config/properties/headers/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data3.disabledTools !== undefined){
let data13 = data3.disabledTools;
if(Array.isArray(data13)){
const len1 = data13.length;
for(let i1=0; i1<len1; i1++){
if(typeof data13[i1] !== "string"){
const err23 = {instancePath:instancePath+"/config/disabledTools/" + i1,schemaPath:"#/properties/config/properties/disabledTools/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
}
else {
const err24 = {instancePath:instancePath+"/config/disabledTools",schemaPath:"#/properties/config/properties/disabledTools/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data3.oauth !== undefined){
let data15 = data3.oauth;
if(data15 && typeof data15 == "object" && !Array.isArray(data15)){
for(const key4 in data15){
if(!(func8.call(schema36.properties.config.properties.oauth.properties, key4))){
const err25 = {instancePath:instancePath+"/config/oauth",schemaPath:"#/properties/config/properties/oauth/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key4},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data15.clientName !== undefined){
if(typeof data15.clientName !== "string"){
const err26 = {instancePath:instancePath+"/config/oauth/clientName",schemaPath:"#/properties/config/properties/oauth/properties/clientName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data15.clientId !== undefined){
if(typeof data15.clientId !== "string"){
const err27 = {instancePath:instancePath+"/config/oauth/clientId",schemaPath:"#/properties/config/properties/oauth/properties/clientId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data15.redirectUri !== undefined){
if(typeof data15.redirectUri !== "string"){
const err28 = {instancePath:instancePath+"/config/oauth/redirectUri",schemaPath:"#/properties/config/properties/oauth/properties/redirectUri/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data15.authorizationServerOrigin !== undefined){
if(typeof data15.authorizationServerOrigin !== "string"){
const err29 = {instancePath:instancePath+"/config/oauth/authorizationServerOrigin",schemaPath:"#/properties/config/properties/oauth/properties/authorizationServerOrigin/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data15.resourceMetadataUrl !== undefined){
if(typeof data15.resourceMetadataUrl !== "string"){
const err30 = {instancePath:instancePath+"/config/oauth/resourceMetadataUrl",schemaPath:"#/properties/config/properties/oauth/properties/resourceMetadataUrl/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data15.authServerMetadataUrl !== undefined){
if(typeof data15.authServerMetadataUrl !== "string"){
const err31 = {instancePath:instancePath+"/config/oauth/authServerMetadataUrl",schemaPath:"#/properties/config/properties/oauth/properties/authServerMetadataUrl/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data15.callbackPort !== undefined){
let data22 = data15.callbackPort;
if(!((typeof data22 == "number") && (!(data22 % 1) && !isNaN(data22)))){
const err32 = {instancePath:instancePath+"/config/oauth/callbackPort",schemaPath:"#/properties/config/properties/oauth/properties/callbackPort/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(typeof data22 == "number"){
if(data22 > 65535 || isNaN(data22)){
const err33 = {instancePath:instancePath+"/config/oauth/callbackPort",schemaPath:"#/properties/config/properties/oauth/properties/callbackPort/maximum",keyword:"maximum",params:{comparison: "<=", limit: 65535},message:"must be <= 65535"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data22 < 1 || isNaN(data22)){
const err34 = {instancePath:instancePath+"/config/oauth/callbackPort",schemaPath:"#/properties/config/properties/oauth/properties/callbackPort/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
}
if(data15.omitRegistrationScope !== undefined){
if(typeof data15.omitRegistrationScope !== "boolean"){
const err35 = {instancePath:instancePath+"/config/oauth/omitRegistrationScope",schemaPath:"#/properties/config/properties/oauth/properties/omitRegistrationScope/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data15.xaa !== undefined){
if(typeof data15.xaa !== "boolean"){
const err36 = {instancePath:instancePath+"/config/oauth/xaa",schemaPath:"#/properties/config/properties/oauth/properties/xaa/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
else {
const err37 = {instancePath:instancePath+"/config/oauth",schemaPath:"#/properties/config/properties/oauth/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
}
else {
const err38 = {instancePath:instancePath+"/config",schemaPath:"#/properties/config/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
}
else {
const err39 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
validate35.errors = vErrors;
return errors === 0;
}

export const v26 = validate36;
const schema37 = {"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"}},"required":["name"],"additionalProperties":false};

function validate36(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.name === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "name")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.name !== undefined){
let data0 = data.name;
if(typeof data0 === "string"){
if(func2(data0) > 64){
const err2 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern23.test(data0)){
const err4 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[a-zA-Z0-9_-]+$"},message:"must match pattern \""+"^[a-zA-Z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate36.errors = vErrors;
return errors === 0;
}

export const v27 = validate37;
const schema38 = {"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"},"enabled":{"type":"boolean"}},"required":["name","enabled"],"additionalProperties":false};

function validate37(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.name === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.enabled === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "enabled"},message:"must have required property '"+"enabled"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "name") || (key0 === "enabled"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.name !== undefined){
let data0 = data.name;
if(typeof data0 === "string"){
if(func2(data0) > 64){
const err3 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern23.test(data0)){
const err5 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[a-zA-Z0-9_-]+$"},message:"must match pattern \""+"^[a-zA-Z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.enabled !== undefined){
if(typeof data.enabled !== "boolean"){
const err7 = {instancePath:instancePath+"/enabled",schemaPath:"#/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
else {
const err8 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
validate37.errors = vErrors;
return errors === 0;
}

export const v28 = validate38;
const schema39 = {"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"}},"required":["name"],"additionalProperties":false};

function validate38(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.name === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "name")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.name !== undefined){
let data0 = data.name;
if(typeof data0 === "string"){
if(func2(data0) > 64){
const err2 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern23.test(data0)){
const err4 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[a-zA-Z0-9_-]+$"},message:"must match pattern \""+"^[a-zA-Z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate38.errors = vErrors;
return errors === 0;
}

export const v29 = validate39;
const schema40 = {"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"}},"required":["name"],"additionalProperties":false};

function validate39(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.name === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "name")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.name !== undefined){
let data0 = data.name;
if(typeof data0 === "string"){
if(func2(data0) > 64){
const err2 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern23.test(data0)){
const err4 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[a-zA-Z0-9_-]+$"},message:"must match pattern \""+"^[a-zA-Z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate39.errors = vErrors;
return errors === 0;
}

export const v30 = validate40;
const schema41 = {"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"}},"required":["name"],"additionalProperties":false};

function validate40(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.name === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "name")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.name !== undefined){
let data0 = data.name;
if(typeof data0 === "string"){
if(func2(data0) > 64){
const err2 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern23.test(data0)){
const err4 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[a-zA-Z0-9_-]+$"},message:"must match pattern \""+"^[a-zA-Z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate40.errors = vErrors;
return errors === 0;
}

export const validatorKeys = {
  "[\"moss.tasks/v1\",\"task.create\",\"input\"]": "v0",
  "[\"moss.tasks/v1\",\"task.create\",\"output\"]": "v1",
  "[\"moss.tasks/v1\",\"task.get\",\"input\"]": "v2",
  "[\"moss.tasks/v1\",\"task.get\",\"output\"]": "v1",
  "[\"moss.tasks/v1\",\"task.list\",\"input\"]": "v3",
  "[\"moss.tasks/v1\",\"task.list\",\"output\"]": "v4",
  "[\"moss.tasks/v1\",\"task.update\",\"input\"]": "v5",
  "[\"moss.tasks/v1\",\"task.update\",\"output\"]": "v1",
  "[\"moss.tasks/v1\",\"task.finish\",\"input\"]": "v6",
  "[\"moss.tasks/v1\",\"task.finish\",\"output\"]": "v1",
  "[\"moss.tasks/v1\",\"task.cancel\",\"input\"]": "v7",
  "[\"moss.tasks/v1\",\"task.cancel\",\"output\"]": "v1",
  "[\"moss.tasks/v1\",\"task.resume\",\"input\"]": "v8",
  "[\"moss.tasks/v1\",\"task.resume\",\"output\"]": "v1",
  "[\"moss.tasks/v1\",\"task.changed\",\"event\"]": "v9",
  "[\"moss.agent-execution/v1\",\"capabilities\",\"input\"]": "v10",
  "[\"moss.agent-execution/v1\",\"capabilities\",\"output\"]": "v11",
  "[\"moss.agent-execution/v1\",\"execution.start\",\"input\"]": "v12",
  "[\"moss.agent-execution/v1\",\"execution.start\",\"output\"]": "v13",
  "[\"moss.agent-execution/v1\",\"execution.get\",\"input\"]": "v14",
  "[\"moss.agent-execution/v1\",\"execution.get\",\"output\"]": "v13",
  "[\"moss.agent-execution/v1\",\"execution.list\",\"input\"]": "v15",
  "[\"moss.agent-execution/v1\",\"execution.list\",\"output\"]": "v16",
  "[\"moss.agent-execution/v1\",\"execution.cancel\",\"input\"]": "v17",
  "[\"moss.agent-execution/v1\",\"execution.cancel\",\"output\"]": "v13",
  "[\"moss.agent-execution/v1\",\"execution.events\",\"input\"]": "v18",
  "[\"moss.agent-execution/v1\",\"execution.events\",\"output\"]": "v19",
  "[\"moss.agent-execution/v1\",\"execution.result.read\",\"input\"]": "v20",
  "[\"moss.agent-execution/v1\",\"execution.result.read\",\"output\"]": "v21",
  "[\"moss.agent-execution/v1\",\"execution.changed\",\"event\"]": "v22",
  "[\"moss.mcp/v1\",\"servers.list\",\"input\"]": "v23",
  "[\"moss.mcp/v1\",\"servers.list\",\"output\"]": "v24",
  "[\"moss.mcp/v1\",\"servers.save\",\"input\"]": "v25",
  "[\"moss.mcp/v1\",\"servers.save\",\"output\"]": "v24",
  "[\"moss.mcp/v1\",\"servers.remove\",\"input\"]": "v26",
  "[\"moss.mcp/v1\",\"servers.remove\",\"output\"]": "v24",
  "[\"moss.mcp/v1\",\"servers.set-enabled\",\"input\"]": "v27",
  "[\"moss.mcp/v1\",\"servers.set-enabled\",\"output\"]": "v24",
  "[\"moss.mcp/v1\",\"servers.inspect\",\"input\"]": "v28",
  "[\"moss.mcp/v1\",\"servers.inspect\",\"output\"]": "v24",
  "[\"moss.mcp/v1\",\"auth.start\",\"input\"]": "v29",
  "[\"moss.mcp/v1\",\"auth.start\",\"output\"]": "v24",
  "[\"moss.mcp/v1\",\"auth.clear\",\"input\"]": "v30",
  "[\"moss.mcp/v1\",\"auth.clear\",\"output\"]": "v24"
}
