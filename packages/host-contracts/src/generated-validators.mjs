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
const schema12 = {"type":"object","properties":{"id":{"type":"string","minLength":1},"appId":{"type":"string","minLength":1},"instanceId":{"type":"string","minLength":1},"title":{"type":"string","minLength":1},"route":{"type":"string","minLength":1},"status":{"enum":["running","completed","failed","cancelled","interrupted"]},"revision":{"type":"integer","minimum":1},"scopeRef":{"type":"string","minLength":1},"attempt":{"type":"integer","minimum":1},"limits":{"type":"object","properties":{"maxConcurrency":{"type":"integer","minimum":1},"maxCalls":{"type":"integer","minimum":1},"maxDurationMs":{"type":"integer","minimum":1},"maxTokens":{"type":"integer","minimum":1}},"required":["maxConcurrency","maxCalls","maxDurationMs","maxTokens"],"additionalProperties":false},"createdAt":{"type":"integer","minimum":1},"updatedAt":{"type":"integer","minimum":1},"deadlineAt":{"type":"integer","minimum":1},"sessionId":{"type":"string","minLength":1},"workspace":{"type":"string"},"executionCount":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"expiresAt":{"type":"integer","minimum":0},"summary":{"type":"string"},"progress":{"type":"number","minimum":0,"maximum":1},"result":{},"error":{"type":"string"}},"required":["id","appId","instanceId","title","route","status","revision","scopeRef","attempt","limits","createdAt","updatedAt","deadlineAt","sessionId","executionCount","tokens"],"additionalProperties":false};
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
if(data.expiresAt !== undefined){
let data21 = data.expiresAt;
if(!((typeof data21 == "number") && (!(data21 % 1) && !isNaN(data21)))){
const err61 = {instancePath:instancePath+"/expiresAt",schemaPath:"#/properties/expiresAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
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
const err62 = {instancePath:instancePath+"/expiresAt",schemaPath:"#/properties/expiresAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.summary !== undefined){
if(typeof data.summary !== "string"){
const err63 = {instancePath:instancePath+"/summary",schemaPath:"#/properties/summary/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
}
if(data.progress !== undefined){
let data23 = data.progress;
if(typeof data23 == "number"){
if(data23 > 1 || isNaN(data23)){
const err64 = {instancePath:instancePath+"/progress",schemaPath:"#/properties/progress/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
if(data23 < 0 || isNaN(data23)){
const err65 = {instancePath:instancePath+"/progress",schemaPath:"#/properties/progress/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
const err66 = {instancePath:instancePath+"/progress",schemaPath:"#/properties/progress/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
}
if(data.error !== undefined){
if(typeof data.error !== "string"){
const err67 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err68 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
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
const schema14 = {"type":"object","properties":{"cursor":{"type":"string","minLength":1,"maxLength":2048,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"limit":{"type":"integer","minimum":1,"maximum":10}},"required":[],"additionalProperties":false};

function validate13(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!((key0 === "cursor") || (key0 === "limit"))){
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
if(data.cursor !== undefined){
let data0 = data.cursor;
if(typeof data0 === "string"){
if(func2(data0) > 2048){
const err1 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/maxLength",keyword:"maxLength",params:{limit: 2048},message:"must NOT have more than 2048 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(func2(data0) < 1){
const err2 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(!pattern0.test(data0)){
const err3 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
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
const err4 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.limit !== undefined){
let data1 = data.limit;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err5 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 > 10 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 10},message:"must be <= 10"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1 < 1 || isNaN(data1)){
const err7 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
validate13.errors = vErrors;
return errors === 0;
}

export const v4 = validate14;
const schema15 = {"type":"object","properties":{"tasks":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1},"appId":{"type":"string","minLength":1},"instanceId":{"type":"string","minLength":1},"title":{"type":"string","minLength":1},"route":{"type":"string","minLength":1},"status":{"enum":["running","completed","failed","cancelled","interrupted"]},"revision":{"type":"integer","minimum":1},"scopeRef":{"type":"string","minLength":1},"attempt":{"type":"integer","minimum":1},"limits":{"type":"object","properties":{"maxConcurrency":{"type":"integer","minimum":1},"maxCalls":{"type":"integer","minimum":1},"maxDurationMs":{"type":"integer","minimum":1},"maxTokens":{"type":"integer","minimum":1}},"required":["maxConcurrency","maxCalls","maxDurationMs","maxTokens"],"additionalProperties":false},"createdAt":{"type":"integer","minimum":1},"updatedAt":{"type":"integer","minimum":1},"deadlineAt":{"type":"integer","minimum":1},"sessionId":{"type":"string","minLength":1},"workspace":{"type":"string"},"executionCount":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"expiresAt":{"type":"integer","minimum":0},"summary":{"type":"string"},"progress":{"type":"number","minimum":0,"maximum":1},"result":{},"error":{"type":"string"}},"required":["id","appId","instanceId","title","route","status","revision","scopeRef","attempt","limits","createdAt","updatedAt","deadlineAt","sessionId","executionCount","tokens"],"additionalProperties":false},"maxItems":10},"nextCursor":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["tasks","nextCursor"],"additionalProperties":false};

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
if(data.nextCursor === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "nextCursor"},message:"must have required property '"+"nextCursor"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "tasks") || (key0 === "nextCursor"))){
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
if(data.tasks !== undefined){
let data0 = data.tasks;
if(Array.isArray(data0)){
if(data0.length > 10){
const err3 = {instancePath:instancePath+"/tasks",schemaPath:"#/properties/tasks/maxItems",keyword:"maxItems",params:{limit: 10},message:"must NOT have more than 10 items"};
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
if(data1.id === undefined){
const err4 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.appId === undefined){
const err5 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "appId"},message:"must have required property '"+"appId"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.instanceId === undefined){
const err6 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "instanceId"},message:"must have required property '"+"instanceId"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.title === undefined){
const err7 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.route === undefined){
const err8 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "route"},message:"must have required property '"+"route"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1.status === undefined){
const err9 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data1.revision === undefined){
const err10 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data1.scopeRef === undefined){
const err11 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "scopeRef"},message:"must have required property '"+"scopeRef"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data1.attempt === undefined){
const err12 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "attempt"},message:"must have required property '"+"attempt"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data1.limits === undefined){
const err13 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "limits"},message:"must have required property '"+"limits"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data1.createdAt === undefined){
const err14 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data1.updatedAt === undefined){
const err15 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "updatedAt"},message:"must have required property '"+"updatedAt"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data1.deadlineAt === undefined){
const err16 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "deadlineAt"},message:"must have required property '"+"deadlineAt"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data1.sessionId === undefined){
const err17 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "sessionId"},message:"must have required property '"+"sessionId"+"'"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(data1.executionCount === undefined){
const err18 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "executionCount"},message:"must have required property '"+"executionCount"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data1.tokens === undefined){
const err19 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/required",keyword:"required",params:{missingProperty: "tokens"},message:"must have required property '"+"tokens"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
for(const key1 in data1){
if(!(func8.call(schema15.properties.tasks.items.properties, key1))){
const err20 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data1.id !== undefined){
let data2 = data1.id;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err21 = {instancePath:instancePath+"/tasks/" + i0+"/id",schemaPath:"#/properties/tasks/items/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err22 = {instancePath:instancePath+"/tasks/" + i0+"/id",schemaPath:"#/properties/tasks/items/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data1.appId !== undefined){
let data3 = data1.appId;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err23 = {instancePath:instancePath+"/tasks/" + i0+"/appId",schemaPath:"#/properties/tasks/items/properties/appId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err24 = {instancePath:instancePath+"/tasks/" + i0+"/appId",schemaPath:"#/properties/tasks/items/properties/appId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data1.instanceId !== undefined){
let data4 = data1.instanceId;
if(typeof data4 === "string"){
if(func2(data4) < 1){
const err25 = {instancePath:instancePath+"/tasks/" + i0+"/instanceId",schemaPath:"#/properties/tasks/items/properties/instanceId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err26 = {instancePath:instancePath+"/tasks/" + i0+"/instanceId",schemaPath:"#/properties/tasks/items/properties/instanceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data1.title !== undefined){
let data5 = data1.title;
if(typeof data5 === "string"){
if(func2(data5) < 1){
const err27 = {instancePath:instancePath+"/tasks/" + i0+"/title",schemaPath:"#/properties/tasks/items/properties/title/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err28 = {instancePath:instancePath+"/tasks/" + i0+"/title",schemaPath:"#/properties/tasks/items/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data1.route !== undefined){
let data6 = data1.route;
if(typeof data6 === "string"){
if(func2(data6) < 1){
const err29 = {instancePath:instancePath+"/tasks/" + i0+"/route",schemaPath:"#/properties/tasks/items/properties/route/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/tasks/" + i0+"/route",schemaPath:"#/properties/tasks/items/properties/route/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data1.status !== undefined){
let data7 = data1.status;
if(!(((((data7 === "running") || (data7 === "completed")) || (data7 === "failed")) || (data7 === "cancelled")) || (data7 === "interrupted"))){
const err31 = {instancePath:instancePath+"/tasks/" + i0+"/status",schemaPath:"#/properties/tasks/items/properties/status/enum",keyword:"enum",params:{allowedValues: schema15.properties.tasks.items.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data1.revision !== undefined){
let data8 = data1.revision;
if(!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))){
const err32 = {instancePath:instancePath+"/tasks/" + i0+"/revision",schemaPath:"#/properties/tasks/items/properties/revision/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
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
const err33 = {instancePath:instancePath+"/tasks/" + i0+"/revision",schemaPath:"#/properties/tasks/items/properties/revision/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data1.scopeRef !== undefined){
let data9 = data1.scopeRef;
if(typeof data9 === "string"){
if(func2(data9) < 1){
const err34 = {instancePath:instancePath+"/tasks/" + i0+"/scopeRef",schemaPath:"#/properties/tasks/items/properties/scopeRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err35 = {instancePath:instancePath+"/tasks/" + i0+"/scopeRef",schemaPath:"#/properties/tasks/items/properties/scopeRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data1.attempt !== undefined){
let data10 = data1.attempt;
if(!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))){
const err36 = {instancePath:instancePath+"/tasks/" + i0+"/attempt",schemaPath:"#/properties/tasks/items/properties/attempt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(typeof data10 == "number"){
if(data10 < 1 || isNaN(data10)){
const err37 = {instancePath:instancePath+"/tasks/" + i0+"/attempt",schemaPath:"#/properties/tasks/items/properties/attempt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data1.limits !== undefined){
let data11 = data1.limits;
if(data11 && typeof data11 == "object" && !Array.isArray(data11)){
if(data11.maxConcurrency === undefined){
const err38 = {instancePath:instancePath+"/tasks/" + i0+"/limits",schemaPath:"#/properties/tasks/items/properties/limits/required",keyword:"required",params:{missingProperty: "maxConcurrency"},message:"must have required property '"+"maxConcurrency"+"'"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(data11.maxCalls === undefined){
const err39 = {instancePath:instancePath+"/tasks/" + i0+"/limits",schemaPath:"#/properties/tasks/items/properties/limits/required",keyword:"required",params:{missingProperty: "maxCalls"},message:"must have required property '"+"maxCalls"+"'"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(data11.maxDurationMs === undefined){
const err40 = {instancePath:instancePath+"/tasks/" + i0+"/limits",schemaPath:"#/properties/tasks/items/properties/limits/required",keyword:"required",params:{missingProperty: "maxDurationMs"},message:"must have required property '"+"maxDurationMs"+"'"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
if(data11.maxTokens === undefined){
const err41 = {instancePath:instancePath+"/tasks/" + i0+"/limits",schemaPath:"#/properties/tasks/items/properties/limits/required",keyword:"required",params:{missingProperty: "maxTokens"},message:"must have required property '"+"maxTokens"+"'"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
for(const key2 in data11){
if(!((((key2 === "maxConcurrency") || (key2 === "maxCalls")) || (key2 === "maxDurationMs")) || (key2 === "maxTokens"))){
const err42 = {instancePath:instancePath+"/tasks/" + i0+"/limits",schemaPath:"#/properties/tasks/items/properties/limits/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
if(data11.maxConcurrency !== undefined){
let data12 = data11.maxConcurrency;
if(!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))){
const err43 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxConcurrency",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxConcurrency/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
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
const err44 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxConcurrency",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxConcurrency/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data11.maxCalls !== undefined){
let data13 = data11.maxCalls;
if(!((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13)))){
const err45 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxCalls",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxCalls/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
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
const err46 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxCalls",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxCalls/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data11.maxDurationMs !== undefined){
let data14 = data11.maxDurationMs;
if(!((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14)))){
const err47 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxDurationMs",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxDurationMs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
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
const err48 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxDurationMs",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxDurationMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data11.maxTokens !== undefined){
let data15 = data11.maxTokens;
if(!((typeof data15 == "number") && (!(data15 % 1) && !isNaN(data15)))){
const err49 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxTokens",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxTokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
if(typeof data15 == "number"){
if(data15 < 1 || isNaN(data15)){
const err50 = {instancePath:instancePath+"/tasks/" + i0+"/limits/maxTokens",schemaPath:"#/properties/tasks/items/properties/limits/properties/maxTokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
}
}
else {
const err51 = {instancePath:instancePath+"/tasks/" + i0+"/limits",schemaPath:"#/properties/tasks/items/properties/limits/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
if(data1.createdAt !== undefined){
let data16 = data1.createdAt;
if(!((typeof data16 == "number") && (!(data16 % 1) && !isNaN(data16)))){
const err52 = {instancePath:instancePath+"/tasks/" + i0+"/createdAt",schemaPath:"#/properties/tasks/items/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
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
const err53 = {instancePath:instancePath+"/tasks/" + i0+"/createdAt",schemaPath:"#/properties/tasks/items/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data1.updatedAt !== undefined){
let data17 = data1.updatedAt;
if(!((typeof data17 == "number") && (!(data17 % 1) && !isNaN(data17)))){
const err54 = {instancePath:instancePath+"/tasks/" + i0+"/updatedAt",schemaPath:"#/properties/tasks/items/properties/updatedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
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
const err55 = {instancePath:instancePath+"/tasks/" + i0+"/updatedAt",schemaPath:"#/properties/tasks/items/properties/updatedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data1.deadlineAt !== undefined){
let data18 = data1.deadlineAt;
if(!((typeof data18 == "number") && (!(data18 % 1) && !isNaN(data18)))){
const err56 = {instancePath:instancePath+"/tasks/" + i0+"/deadlineAt",schemaPath:"#/properties/tasks/items/properties/deadlineAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
if(typeof data18 == "number"){
if(data18 < 1 || isNaN(data18)){
const err57 = {instancePath:instancePath+"/tasks/" + i0+"/deadlineAt",schemaPath:"#/properties/tasks/items/properties/deadlineAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data1.sessionId !== undefined){
let data19 = data1.sessionId;
if(typeof data19 === "string"){
if(func2(data19) < 1){
const err58 = {instancePath:instancePath+"/tasks/" + i0+"/sessionId",schemaPath:"#/properties/tasks/items/properties/sessionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
}
else {
const err59 = {instancePath:instancePath+"/tasks/" + i0+"/sessionId",schemaPath:"#/properties/tasks/items/properties/sessionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
}
if(data1.workspace !== undefined){
if(typeof data1.workspace !== "string"){
const err60 = {instancePath:instancePath+"/tasks/" + i0+"/workspace",schemaPath:"#/properties/tasks/items/properties/workspace/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
}
if(data1.executionCount !== undefined){
let data21 = data1.executionCount;
if(!((typeof data21 == "number") && (!(data21 % 1) && !isNaN(data21)))){
const err61 = {instancePath:instancePath+"/tasks/" + i0+"/executionCount",schemaPath:"#/properties/tasks/items/properties/executionCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
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
const err62 = {instancePath:instancePath+"/tasks/" + i0+"/executionCount",schemaPath:"#/properties/tasks/items/properties/executionCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data1.tokens !== undefined){
let data22 = data1.tokens;
if(!((typeof data22 == "number") && (!(data22 % 1) && !isNaN(data22)))){
const err63 = {instancePath:instancePath+"/tasks/" + i0+"/tokens",schemaPath:"#/properties/tasks/items/properties/tokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
if(typeof data22 == "number"){
if(data22 < 0 || isNaN(data22)){
const err64 = {instancePath:instancePath+"/tasks/" + i0+"/tokens",schemaPath:"#/properties/tasks/items/properties/tokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data1.expiresAt !== undefined){
let data23 = data1.expiresAt;
if(!((typeof data23 == "number") && (!(data23 % 1) && !isNaN(data23)))){
const err65 = {instancePath:instancePath+"/tasks/" + i0+"/expiresAt",schemaPath:"#/properties/tasks/items/properties/expiresAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
if(typeof data23 == "number"){
if(data23 < 0 || isNaN(data23)){
const err66 = {instancePath:instancePath+"/tasks/" + i0+"/expiresAt",schemaPath:"#/properties/tasks/items/properties/expiresAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
}
}
if(data1.summary !== undefined){
if(typeof data1.summary !== "string"){
const err67 = {instancePath:instancePath+"/tasks/" + i0+"/summary",schemaPath:"#/properties/tasks/items/properties/summary/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
}
if(data1.progress !== undefined){
let data25 = data1.progress;
if(typeof data25 == "number"){
if(data25 > 1 || isNaN(data25)){
const err68 = {instancePath:instancePath+"/tasks/" + i0+"/progress",schemaPath:"#/properties/tasks/items/properties/progress/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
if(data25 < 0 || isNaN(data25)){
const err69 = {instancePath:instancePath+"/tasks/" + i0+"/progress",schemaPath:"#/properties/tasks/items/properties/progress/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
}
else {
const err70 = {instancePath:instancePath+"/tasks/" + i0+"/progress",schemaPath:"#/properties/tasks/items/properties/progress/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
}
if(data1.error !== undefined){
if(typeof data1.error !== "string"){
const err71 = {instancePath:instancePath+"/tasks/" + i0+"/error",schemaPath:"#/properties/tasks/items/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
}
}
else {
const err72 = {instancePath:instancePath+"/tasks/" + i0,schemaPath:"#/properties/tasks/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
}
}
else {
const err73 = {instancePath:instancePath+"/tasks",schemaPath:"#/properties/tasks/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
}
if(data.nextCursor !== undefined){
let data27 = data.nextCursor;
const _errs58 = errors;
let valid5 = false;
const _errs59 = errors;
if(typeof data27 === "string"){
if(func2(data27) < 1){
const err74 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
}
else {
const err75 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
var _valid0 = _errs59 === errors;
valid5 = valid5 || _valid0;
if(!valid5){
const _errs61 = errors;
if(data27 !== null){
const err76 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
var _valid0 = _errs61 === errors;
valid5 = valid5 || _valid0;
}
if(!valid5){
const err77 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
else {
errors = _errs58;
if(vErrors !== null){
if(_errs58){
vErrors.length = _errs58;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err78 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
validate14.errors = vErrors;
return errors === 0;
}

export const v5 = validate15;
const schema16 = {"type":"object","properties":{"afterCursor":{"type":"string","minLength":1,"maxLength":2048,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"limit":{"type":"integer","minimum":1,"maximum":100}},"required":[],"additionalProperties":false};

function validate15(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!((key0 === "afterCursor") || (key0 === "limit"))){
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
if(data.afterCursor !== undefined){
let data0 = data.afterCursor;
if(typeof data0 === "string"){
if(func2(data0) > 2048){
const err1 = {instancePath:instancePath+"/afterCursor",schemaPath:"#/properties/afterCursor/maxLength",keyword:"maxLength",params:{limit: 2048},message:"must NOT have more than 2048 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(func2(data0) < 1){
const err2 = {instancePath:instancePath+"/afterCursor",schemaPath:"#/properties/afterCursor/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(!pattern0.test(data0)){
const err3 = {instancePath:instancePath+"/afterCursor",schemaPath:"#/properties/afterCursor/pattern",keyword:"pattern",params:{pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]*$"},message:"must match pattern \""+"^(?=[\\s\\S]*\\S)[^\\u0000]*$"+"\""};
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
const err4 = {instancePath:instancePath+"/afterCursor",schemaPath:"#/properties/afterCursor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.limit !== undefined){
let data1 = data.limit;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err5 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 > 100 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 100},message:"must be <= 100"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1 < 1 || isNaN(data1)){
const err7 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
validate15.errors = vErrors;
return errors === 0;
}

export const v6 = validate16;
const schema17 = {"type":"object","properties":{"changes":{"type":"array","maxItems":100,"items":{"type":"object","properties":{"cursor":{"type":"string","minLength":1},"task":{"type":"object","properties":{"id":{"type":"string","minLength":1},"appId":{"type":"string","minLength":1},"instanceId":{"type":"string","minLength":1},"title":{"type":"string","minLength":1},"route":{"type":"string","minLength":1},"status":{"enum":["running","completed","failed","cancelled","interrupted"]},"revision":{"type":"integer","minimum":1},"scopeRef":{"type":"string","minLength":1},"attempt":{"type":"integer","minimum":1},"limits":{"type":"object","properties":{"maxConcurrency":{"type":"integer","minimum":1},"maxCalls":{"type":"integer","minimum":1},"maxDurationMs":{"type":"integer","minimum":1},"maxTokens":{"type":"integer","minimum":1}},"required":["maxConcurrency","maxCalls","maxDurationMs","maxTokens"],"additionalProperties":false},"createdAt":{"type":"integer","minimum":1},"updatedAt":{"type":"integer","minimum":1},"deadlineAt":{"type":"integer","minimum":1},"sessionId":{"type":"string","minLength":1},"workspace":{"type":"string"},"executionCount":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"expiresAt":{"type":"integer","minimum":0},"summary":{"type":"string"},"progress":{"type":"number","minimum":0,"maximum":1},"result":{},"error":{"type":"string"}},"required":["id","appId","instanceId","title","route","status","revision","scopeRef","attempt","limits","createdAt","updatedAt","deadlineAt","sessionId","executionCount","tokens"],"additionalProperties":false}},"required":["cursor","task"],"additionalProperties":false}},"nextCursor":{"type":"string","minLength":1},"reset":{"type":"boolean"},"hasMore":{"type":"boolean"}},"required":["changes","nextCursor","reset","hasMore"],"additionalProperties":false};

function validate16(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.changes === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "changes"},message:"must have required property '"+"changes"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.nextCursor === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "nextCursor"},message:"must have required property '"+"nextCursor"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.reset === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "reset"},message:"must have required property '"+"reset"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.hasMore === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "hasMore"},message:"must have required property '"+"hasMore"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "changes") || (key0 === "nextCursor")) || (key0 === "reset")) || (key0 === "hasMore"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.changes !== undefined){
let data0 = data.changes;
if(Array.isArray(data0)){
if(data0.length > 100){
const err5 = {instancePath:instancePath+"/changes",schemaPath:"#/properties/changes/maxItems",keyword:"maxItems",params:{limit: 100},message:"must NOT have more than 100 items"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.cursor === undefined){
const err6 = {instancePath:instancePath+"/changes/" + i0,schemaPath:"#/properties/changes/items/required",keyword:"required",params:{missingProperty: "cursor"},message:"must have required property '"+"cursor"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.task === undefined){
const err7 = {instancePath:instancePath+"/changes/" + i0,schemaPath:"#/properties/changes/items/required",keyword:"required",params:{missingProperty: "task"},message:"must have required property '"+"task"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
for(const key1 in data1){
if(!((key1 === "cursor") || (key1 === "task"))){
const err8 = {instancePath:instancePath+"/changes/" + i0,schemaPath:"#/properties/changes/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data1.cursor !== undefined){
let data2 = data1.cursor;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err9 = {instancePath:instancePath+"/changes/" + i0+"/cursor",schemaPath:"#/properties/changes/items/properties/cursor/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err10 = {instancePath:instancePath+"/changes/" + i0+"/cursor",schemaPath:"#/properties/changes/items/properties/cursor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data1.task !== undefined){
let data3 = data1.task;
if(data3 && typeof data3 == "object" && !Array.isArray(data3)){
if(data3.id === undefined){
const err11 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data3.appId === undefined){
const err12 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "appId"},message:"must have required property '"+"appId"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data3.instanceId === undefined){
const err13 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "instanceId"},message:"must have required property '"+"instanceId"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data3.title === undefined){
const err14 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data3.route === undefined){
const err15 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "route"},message:"must have required property '"+"route"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data3.status === undefined){
const err16 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data3.revision === undefined){
const err17 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(data3.scopeRef === undefined){
const err18 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "scopeRef"},message:"must have required property '"+"scopeRef"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data3.attempt === undefined){
const err19 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "attempt"},message:"must have required property '"+"attempt"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data3.limits === undefined){
const err20 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "limits"},message:"must have required property '"+"limits"+"'"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data3.createdAt === undefined){
const err21 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data3.updatedAt === undefined){
const err22 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "updatedAt"},message:"must have required property '"+"updatedAt"+"'"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(data3.deadlineAt === undefined){
const err23 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "deadlineAt"},message:"must have required property '"+"deadlineAt"+"'"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data3.sessionId === undefined){
const err24 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "sessionId"},message:"must have required property '"+"sessionId"+"'"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data3.executionCount === undefined){
const err25 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "executionCount"},message:"must have required property '"+"executionCount"+"'"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(data3.tokens === undefined){
const err26 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/required",keyword:"required",params:{missingProperty: "tokens"},message:"must have required property '"+"tokens"+"'"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
for(const key2 in data3){
if(!(func8.call(schema17.properties.changes.items.properties.task.properties, key2))){
const err27 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data3.id !== undefined){
let data4 = data3.id;
if(typeof data4 === "string"){
if(func2(data4) < 1){
const err28 = {instancePath:instancePath+"/changes/" + i0+"/task/id",schemaPath:"#/properties/changes/items/properties/task/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err29 = {instancePath:instancePath+"/changes/" + i0+"/task/id",schemaPath:"#/properties/changes/items/properties/task/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data3.appId !== undefined){
let data5 = data3.appId;
if(typeof data5 === "string"){
if(func2(data5) < 1){
const err30 = {instancePath:instancePath+"/changes/" + i0+"/task/appId",schemaPath:"#/properties/changes/items/properties/task/properties/appId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err31 = {instancePath:instancePath+"/changes/" + i0+"/task/appId",schemaPath:"#/properties/changes/items/properties/task/properties/appId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data3.instanceId !== undefined){
let data6 = data3.instanceId;
if(typeof data6 === "string"){
if(func2(data6) < 1){
const err32 = {instancePath:instancePath+"/changes/" + i0+"/task/instanceId",schemaPath:"#/properties/changes/items/properties/task/properties/instanceId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err33 = {instancePath:instancePath+"/changes/" + i0+"/task/instanceId",schemaPath:"#/properties/changes/items/properties/task/properties/instanceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data3.title !== undefined){
let data7 = data3.title;
if(typeof data7 === "string"){
if(func2(data7) < 1){
const err34 = {instancePath:instancePath+"/changes/" + i0+"/task/title",schemaPath:"#/properties/changes/items/properties/task/properties/title/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err35 = {instancePath:instancePath+"/changes/" + i0+"/task/title",schemaPath:"#/properties/changes/items/properties/task/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data3.route !== undefined){
let data8 = data3.route;
if(typeof data8 === "string"){
if(func2(data8) < 1){
const err36 = {instancePath:instancePath+"/changes/" + i0+"/task/route",schemaPath:"#/properties/changes/items/properties/task/properties/route/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err37 = {instancePath:instancePath+"/changes/" + i0+"/task/route",schemaPath:"#/properties/changes/items/properties/task/properties/route/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data3.status !== undefined){
let data9 = data3.status;
if(!(((((data9 === "running") || (data9 === "completed")) || (data9 === "failed")) || (data9 === "cancelled")) || (data9 === "interrupted"))){
const err38 = {instancePath:instancePath+"/changes/" + i0+"/task/status",schemaPath:"#/properties/changes/items/properties/task/properties/status/enum",keyword:"enum",params:{allowedValues: schema17.properties.changes.items.properties.task.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
if(data3.revision !== undefined){
let data10 = data3.revision;
if(!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))){
const err39 = {instancePath:instancePath+"/changes/" + i0+"/task/revision",schemaPath:"#/properties/changes/items/properties/task/properties/revision/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
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
const err40 = {instancePath:instancePath+"/changes/" + i0+"/task/revision",schemaPath:"#/properties/changes/items/properties/task/properties/revision/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data3.scopeRef !== undefined){
let data11 = data3.scopeRef;
if(typeof data11 === "string"){
if(func2(data11) < 1){
const err41 = {instancePath:instancePath+"/changes/" + i0+"/task/scopeRef",schemaPath:"#/properties/changes/items/properties/task/properties/scopeRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
else {
const err42 = {instancePath:instancePath+"/changes/" + i0+"/task/scopeRef",schemaPath:"#/properties/changes/items/properties/task/properties/scopeRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
if(data3.attempt !== undefined){
let data12 = data3.attempt;
if(!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))){
const err43 = {instancePath:instancePath+"/changes/" + i0+"/task/attempt",schemaPath:"#/properties/changes/items/properties/task/properties/attempt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
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
const err44 = {instancePath:instancePath+"/changes/" + i0+"/task/attempt",schemaPath:"#/properties/changes/items/properties/task/properties/attempt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data3.limits !== undefined){
let data13 = data3.limits;
if(data13 && typeof data13 == "object" && !Array.isArray(data13)){
if(data13.maxConcurrency === undefined){
const err45 = {instancePath:instancePath+"/changes/" + i0+"/task/limits",schemaPath:"#/properties/changes/items/properties/task/properties/limits/required",keyword:"required",params:{missingProperty: "maxConcurrency"},message:"must have required property '"+"maxConcurrency"+"'"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if(data13.maxCalls === undefined){
const err46 = {instancePath:instancePath+"/changes/" + i0+"/task/limits",schemaPath:"#/properties/changes/items/properties/task/properties/limits/required",keyword:"required",params:{missingProperty: "maxCalls"},message:"must have required property '"+"maxCalls"+"'"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if(data13.maxDurationMs === undefined){
const err47 = {instancePath:instancePath+"/changes/" + i0+"/task/limits",schemaPath:"#/properties/changes/items/properties/task/properties/limits/required",keyword:"required",params:{missingProperty: "maxDurationMs"},message:"must have required property '"+"maxDurationMs"+"'"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
if(data13.maxTokens === undefined){
const err48 = {instancePath:instancePath+"/changes/" + i0+"/task/limits",schemaPath:"#/properties/changes/items/properties/task/properties/limits/required",keyword:"required",params:{missingProperty: "maxTokens"},message:"must have required property '"+"maxTokens"+"'"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
for(const key3 in data13){
if(!((((key3 === "maxConcurrency") || (key3 === "maxCalls")) || (key3 === "maxDurationMs")) || (key3 === "maxTokens"))){
const err49 = {instancePath:instancePath+"/changes/" + i0+"/task/limits",schemaPath:"#/properties/changes/items/properties/task/properties/limits/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key3},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data13.maxConcurrency !== undefined){
let data14 = data13.maxConcurrency;
if(!((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14)))){
const err50 = {instancePath:instancePath+"/changes/" + i0+"/task/limits/maxConcurrency",schemaPath:"#/properties/changes/items/properties/task/properties/limits/properties/maxConcurrency/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
if(typeof data14 == "number"){
if(data14 < 1 || isNaN(data14)){
const err51 = {instancePath:instancePath+"/changes/" + i0+"/task/limits/maxConcurrency",schemaPath:"#/properties/changes/items/properties/task/properties/limits/properties/maxConcurrency/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data13.maxCalls !== undefined){
let data15 = data13.maxCalls;
if(!((typeof data15 == "number") && (!(data15 % 1) && !isNaN(data15)))){
const err52 = {instancePath:instancePath+"/changes/" + i0+"/task/limits/maxCalls",schemaPath:"#/properties/changes/items/properties/task/properties/limits/properties/maxCalls/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
if(typeof data15 == "number"){
if(data15 < 1 || isNaN(data15)){
const err53 = {instancePath:instancePath+"/changes/" + i0+"/task/limits/maxCalls",schemaPath:"#/properties/changes/items/properties/task/properties/limits/properties/maxCalls/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data13.maxDurationMs !== undefined){
let data16 = data13.maxDurationMs;
if(!((typeof data16 == "number") && (!(data16 % 1) && !isNaN(data16)))){
const err54 = {instancePath:instancePath+"/changes/" + i0+"/task/limits/maxDurationMs",schemaPath:"#/properties/changes/items/properties/task/properties/limits/properties/maxDurationMs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
if(typeof data16 == "number"){
if(data16 < 1 || isNaN(data16)){
const err55 = {instancePath:instancePath+"/changes/" + i0+"/task/limits/maxDurationMs",schemaPath:"#/properties/changes/items/properties/task/properties/limits/properties/maxDurationMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data13.maxTokens !== undefined){
let data17 = data13.maxTokens;
if(!((typeof data17 == "number") && (!(data17 % 1) && !isNaN(data17)))){
const err56 = {instancePath:instancePath+"/changes/" + i0+"/task/limits/maxTokens",schemaPath:"#/properties/changes/items/properties/task/properties/limits/properties/maxTokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
if(typeof data17 == "number"){
if(data17 < 1 || isNaN(data17)){
const err57 = {instancePath:instancePath+"/changes/" + i0+"/task/limits/maxTokens",schemaPath:"#/properties/changes/items/properties/task/properties/limits/properties/maxTokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
}
else {
const err58 = {instancePath:instancePath+"/changes/" + i0+"/task/limits",schemaPath:"#/properties/changes/items/properties/task/properties/limits/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
}
if(data3.createdAt !== undefined){
let data18 = data3.createdAt;
if(!((typeof data18 == "number") && (!(data18 % 1) && !isNaN(data18)))){
const err59 = {instancePath:instancePath+"/changes/" + i0+"/task/createdAt",schemaPath:"#/properties/changes/items/properties/task/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
if(typeof data18 == "number"){
if(data18 < 1 || isNaN(data18)){
const err60 = {instancePath:instancePath+"/changes/" + i0+"/task/createdAt",schemaPath:"#/properties/changes/items/properties/task/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data3.updatedAt !== undefined){
let data19 = data3.updatedAt;
if(!((typeof data19 == "number") && (!(data19 % 1) && !isNaN(data19)))){
const err61 = {instancePath:instancePath+"/changes/" + i0+"/task/updatedAt",schemaPath:"#/properties/changes/items/properties/task/properties/updatedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
if(typeof data19 == "number"){
if(data19 < 1 || isNaN(data19)){
const err62 = {instancePath:instancePath+"/changes/" + i0+"/task/updatedAt",schemaPath:"#/properties/changes/items/properties/task/properties/updatedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data3.deadlineAt !== undefined){
let data20 = data3.deadlineAt;
if(!((typeof data20 == "number") && (!(data20 % 1) && !isNaN(data20)))){
const err63 = {instancePath:instancePath+"/changes/" + i0+"/task/deadlineAt",schemaPath:"#/properties/changes/items/properties/task/properties/deadlineAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
if(typeof data20 == "number"){
if(data20 < 1 || isNaN(data20)){
const err64 = {instancePath:instancePath+"/changes/" + i0+"/task/deadlineAt",schemaPath:"#/properties/changes/items/properties/task/properties/deadlineAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data3.sessionId !== undefined){
let data21 = data3.sessionId;
if(typeof data21 === "string"){
if(func2(data21) < 1){
const err65 = {instancePath:instancePath+"/changes/" + i0+"/task/sessionId",schemaPath:"#/properties/changes/items/properties/task/properties/sessionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err66 = {instancePath:instancePath+"/changes/" + i0+"/task/sessionId",schemaPath:"#/properties/changes/items/properties/task/properties/sessionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
}
if(data3.workspace !== undefined){
if(typeof data3.workspace !== "string"){
const err67 = {instancePath:instancePath+"/changes/" + i0+"/task/workspace",schemaPath:"#/properties/changes/items/properties/task/properties/workspace/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
}
if(data3.executionCount !== undefined){
let data23 = data3.executionCount;
if(!((typeof data23 == "number") && (!(data23 % 1) && !isNaN(data23)))){
const err68 = {instancePath:instancePath+"/changes/" + i0+"/task/executionCount",schemaPath:"#/properties/changes/items/properties/task/properties/executionCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
if(typeof data23 == "number"){
if(data23 < 0 || isNaN(data23)){
const err69 = {instancePath:instancePath+"/changes/" + i0+"/task/executionCount",schemaPath:"#/properties/changes/items/properties/task/properties/executionCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data3.tokens !== undefined){
let data24 = data3.tokens;
if(!((typeof data24 == "number") && (!(data24 % 1) && !isNaN(data24)))){
const err70 = {instancePath:instancePath+"/changes/" + i0+"/task/tokens",schemaPath:"#/properties/changes/items/properties/task/properties/tokens/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
if(typeof data24 == "number"){
if(data24 < 0 || isNaN(data24)){
const err71 = {instancePath:instancePath+"/changes/" + i0+"/task/tokens",schemaPath:"#/properties/changes/items/properties/task/properties/tokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
}
}
if(data3.expiresAt !== undefined){
let data25 = data3.expiresAt;
if(!((typeof data25 == "number") && (!(data25 % 1) && !isNaN(data25)))){
const err72 = {instancePath:instancePath+"/changes/" + i0+"/task/expiresAt",schemaPath:"#/properties/changes/items/properties/task/properties/expiresAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
if(typeof data25 == "number"){
if(data25 < 0 || isNaN(data25)){
const err73 = {instancePath:instancePath+"/changes/" + i0+"/task/expiresAt",schemaPath:"#/properties/changes/items/properties/task/properties/expiresAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
}
}
if(data3.summary !== undefined){
if(typeof data3.summary !== "string"){
const err74 = {instancePath:instancePath+"/changes/" + i0+"/task/summary",schemaPath:"#/properties/changes/items/properties/task/properties/summary/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
}
if(data3.progress !== undefined){
let data27 = data3.progress;
if(typeof data27 == "number"){
if(data27 > 1 || isNaN(data27)){
const err75 = {instancePath:instancePath+"/changes/" + i0+"/task/progress",schemaPath:"#/properties/changes/items/properties/task/properties/progress/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
if(data27 < 0 || isNaN(data27)){
const err76 = {instancePath:instancePath+"/changes/" + i0+"/task/progress",schemaPath:"#/properties/changes/items/properties/task/properties/progress/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
}
else {
const err77 = {instancePath:instancePath+"/changes/" + i0+"/task/progress",schemaPath:"#/properties/changes/items/properties/task/properties/progress/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
}
if(data3.error !== undefined){
if(typeof data3.error !== "string"){
const err78 = {instancePath:instancePath+"/changes/" + i0+"/task/error",schemaPath:"#/properties/changes/items/properties/task/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
}
}
else {
const err79 = {instancePath:instancePath+"/changes/" + i0+"/task",schemaPath:"#/properties/changes/items/properties/task/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
else {
const err80 = {instancePath:instancePath+"/changes/" + i0,schemaPath:"#/properties/changes/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
}
}
else {
const err81 = {instancePath:instancePath+"/changes",schemaPath:"#/properties/changes/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
}
}
if(data.nextCursor !== undefined){
let data29 = data.nextCursor;
if(typeof data29 === "string"){
if(func2(data29) < 1){
const err82 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
}
else {
const err83 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
}
if(data.reset !== undefined){
if(typeof data.reset !== "boolean"){
const err84 = {instancePath:instancePath+"/reset",schemaPath:"#/properties/reset/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
}
}
if(data.hasMore !== undefined){
if(typeof data.hasMore !== "boolean"){
const err85 = {instancePath:instancePath+"/hasMore",schemaPath:"#/properties/hasMore/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err85];
}
else {
vErrors.push(err85);
}
errors++;
}
}
}
else {
const err86 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err86];
}
else {
vErrors.push(err86);
}
errors++;
}
validate16.errors = vErrors;
return errors === 0;
}

export const v7 = validate17;
const schema18 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"revision":{"type":"integer","minimum":1},"summary":{"type":"string","minLength":1,"maxLength":20000,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"progress":{"type":"number","minimum":0,"maximum":1}},"required":["taskId","revision"],"additionalProperties":false};

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
validate17.errors = vErrors;
return errors === 0;
}

export const v8 = validate18;
const schema19 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"revision":{"type":"integer","minimum":1},"status":{"enum":["completed","failed"]},"summary":{"type":"string","minLength":1,"maxLength":20000,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"result":{}},"required":["taskId","revision","status"],"additionalProperties":false};

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
const err10 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema19.properties.status.enum},message:"must be equal to one of the allowed values"};
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
validate18.errors = vErrors;
return errors === 0;
}

export const v9 = validate19;
const schema20 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"reason":{"type":"string","minLength":1,"maxLength":1024,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"}},"required":["taskId"],"additionalProperties":false};

function validate19(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate19.errors = vErrors;
return errors === 0;
}

export const v10 = validate20;
const schema21 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"revision":{"type":"integer","minimum":1}},"required":["taskId","revision"],"additionalProperties":false};

function validate20(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate20.errors = vErrors;
return errors === 0;
}

export const v11 = validate21;
const schema22 = {"type":"object","properties":{"task":{"type":"object","properties":{"id":{"type":"string","minLength":1},"appId":{"type":"string","minLength":1},"instanceId":{"type":"string","minLength":1},"title":{"type":"string","minLength":1},"route":{"type":"string","minLength":1},"status":{"enum":["running","completed","failed","cancelled","interrupted"]},"revision":{"type":"integer","minimum":1},"scopeRef":{"type":"string","minLength":1},"attempt":{"type":"integer","minimum":1},"limits":{"type":"object","properties":{"maxConcurrency":{"type":"integer","minimum":1},"maxCalls":{"type":"integer","minimum":1},"maxDurationMs":{"type":"integer","minimum":1},"maxTokens":{"type":"integer","minimum":1}},"required":["maxConcurrency","maxCalls","maxDurationMs","maxTokens"],"additionalProperties":false},"createdAt":{"type":"integer","minimum":1},"updatedAt":{"type":"integer","minimum":1},"deadlineAt":{"type":"integer","minimum":1},"sessionId":{"type":"string","minLength":1},"workspace":{"type":"string"},"executionCount":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"expiresAt":{"type":"integer","minimum":0},"summary":{"type":"string"},"progress":{"type":"number","minimum":0,"maximum":1},"result":{},"error":{"type":"string"}},"required":["id","appId","instanceId","title","route","status","revision","scopeRef","attempt","limits","createdAt","updatedAt","deadlineAt","sessionId","executionCount","tokens"],"additionalProperties":false}},"required":["task"],"additionalProperties":false};

function validate21(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(func8.call(schema22.properties.task.properties, key1))){
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
const err29 = {instancePath:instancePath+"/task/status",schemaPath:"#/properties/task/properties/status/enum",keyword:"enum",params:{allowedValues: schema22.properties.task.properties.status.enum},message:"must be equal to one of the allowed values"};
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
if(data0.expiresAt !== undefined){
let data22 = data0.expiresAt;
if(!((typeof data22 == "number") && (!(data22 % 1) && !isNaN(data22)))){
const err63 = {instancePath:instancePath+"/task/expiresAt",schemaPath:"#/properties/task/properties/expiresAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
if(typeof data22 == "number"){
if(data22 < 0 || isNaN(data22)){
const err64 = {instancePath:instancePath+"/task/expiresAt",schemaPath:"#/properties/task/properties/expiresAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data0.summary !== undefined){
if(typeof data0.summary !== "string"){
const err65 = {instancePath:instancePath+"/task/summary",schemaPath:"#/properties/task/properties/summary/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
}
if(data0.progress !== undefined){
let data24 = data0.progress;
if(typeof data24 == "number"){
if(data24 > 1 || isNaN(data24)){
const err66 = {instancePath:instancePath+"/task/progress",schemaPath:"#/properties/task/properties/progress/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
if(data24 < 0 || isNaN(data24)){
const err67 = {instancePath:instancePath+"/task/progress",schemaPath:"#/properties/task/properties/progress/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
}
else {
const err68 = {instancePath:instancePath+"/task/progress",schemaPath:"#/properties/task/properties/progress/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
}
if(data0.error !== undefined){
if(typeof data0.error !== "string"){
const err69 = {instancePath:instancePath+"/task/error",schemaPath:"#/properties/task/properties/error/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err70 = {instancePath:instancePath+"/task",schemaPath:"#/properties/task/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
validate21.errors = vErrors;
return errors === 0;
}

export const v12 = validate22;
const schema23 = {"type":"object","properties":{},"required":[],"additionalProperties":false};

function validate22(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate22.errors = vErrors;
return errors === 0;
}

export const v13 = validate23;
const schema24 = {"type":"object","properties":{"environment":{"const":"local"},"structuredOutput":{"type":"boolean"},"contextReuse":{"type":"boolean"},"maxConcurrency":{"type":"integer","minimum":1},"events":{"type":"boolean"}},"required":["environment","structuredOutput","contextReuse","maxConcurrency","events"],"additionalProperties":false};

function validate23(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate23.errors = vErrors;
return errors === 0;
}

export const v14 = validate24;
const schema25 = {"type":"object","properties":{"scopeRef":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"idempotencyKey":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"contextKey":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"prompt":{"type":"string","minLength":1,"maxLength":100000,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"outputSchema":{"anyOf":[{"type":"object","additionalProperties":true},{"type":"boolean"}]},"agentType":{"type":"string","minLength":1,"maxLength":1024,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"resources":{"type":"object","properties":{"tools":{"type":"array","maxItems":512,"items":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"}}},"required":["tools"],"additionalProperties":false},"timeoutMs":{"type":"integer","minimum":1,"maximum":1800000}},"required":["scopeRef","idempotencyKey","contextKey","prompt","outputSchema"],"additionalProperties":false};

function validate24(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate24.errors = vErrors;
return errors === 0;
}

export const v15 = validate25;
const schema26 = {"type":"object","properties":{"id":{"type":"string","minLength":1},"key":{"type":"string","minLength":1},"taskId":{"type":"string","minLength":1},"contextKey":{"type":"string","minLength":1},"contextRef":{"type":"string","minLength":1},"status":{"enum":["queued","running","completed","failed","cancelled","interrupted"]},"sequence":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"toolCalls":{"type":"integer","minimum":0},"createdAt":{"type":"integer","minimum":1},"attempt":{"type":"integer","minimum":1},"resultRef":{"type":"string","minLength":1},"error":{"type":"string"}},"required":["id","key","taskId","contextKey","contextRef","status","sequence","tokens","toolCalls","createdAt","attempt"],"additionalProperties":false};

function validate25(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(func8.call(schema26.properties, key0))){
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
const err22 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema26.properties.status.enum},message:"must be equal to one of the allowed values"};
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
validate25.errors = vErrors;
return errors === 0;
}

export const v16 = validate26;
const schema27 = {"type":"object","properties":{"executionId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"}},"required":["executionId"],"additionalProperties":false};

function validate26(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate26.errors = vErrors;
return errors === 0;
}

export const v17 = validate27;
const schema28 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"}},"required":["taskId"],"additionalProperties":false};

function validate27(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate27.errors = vErrors;
return errors === 0;
}

export const v18 = validate28;
const schema29 = {"type":"object","properties":{"executions":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1},"key":{"type":"string","minLength":1},"taskId":{"type":"string","minLength":1},"contextKey":{"type":"string","minLength":1},"contextRef":{"type":"string","minLength":1},"status":{"enum":["queued","running","completed","failed","cancelled","interrupted"]},"sequence":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"toolCalls":{"type":"integer","minimum":0},"createdAt":{"type":"integer","minimum":1},"attempt":{"type":"integer","minimum":1},"resultRef":{"type":"string","minLength":1},"error":{"type":"string"}},"required":["id","key","taskId","contextKey","contextRef","status","sequence","tokens","toolCalls","createdAt","attempt"],"additionalProperties":false},"maxItems":256}},"required":["executions"],"additionalProperties":false};

function validate28(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(func8.call(schema29.properties.executions.items.properties, key1))){
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
const err25 = {instancePath:instancePath+"/executions/" + i0+"/status",schemaPath:"#/properties/executions/items/properties/status/enum",keyword:"enum",params:{allowedValues: schema29.properties.executions.items.properties.status.enum},message:"must be equal to one of the allowed values"};
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
validate28.errors = vErrors;
return errors === 0;
}

export const v19 = validate29;
const schema30 = {"type":"object","properties":{"executionId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"reason":{"type":"string","minLength":1,"maxLength":1024,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"}},"required":["executionId"],"additionalProperties":false};

function validate29(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate29.errors = vErrors;
return errors === 0;
}

export const v20 = validate30;
const schema31 = {"type":"object","properties":{"executionId":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"afterSequence":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":200}},"required":["executionId"],"additionalProperties":false};

function validate30(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate30.errors = vErrors;
return errors === 0;
}

export const v21 = validate31;
const schema32 = {"type":"object","properties":{"events":{"type":"array","items":{"type":"object","properties":{"eventId":{"type":"string","minLength":1},"executionId":{"type":"string","minLength":1},"sequence":{"type":"integer","minimum":1},"timestamp":{"type":"integer","minimum":1},"type":{"enum":["queued","running","progress","completed","failed","cancelled","interrupted"]},"tokens":{"type":"integer","minimum":0},"toolCalls":{"type":"integer","minimum":0},"lastToolName":{"type":["string","null"]},"error":{"type":"string"}},"required":["eventId","executionId","sequence","timestamp","type"],"additionalProperties":false},"maxItems":200},"earliestSequence":{"type":"integer","minimum":0}},"required":["events","earliestSequence"],"additionalProperties":false};

function validate31(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(func8.call(schema32.properties.events.items.properties, key1))){
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
const err18 = {instancePath:instancePath+"/events/" + i0+"/type",schemaPath:"#/properties/events/items/properties/type/enum",keyword:"enum",params:{allowedValues: schema32.properties.events.items.properties.type.enum},message:"must be equal to one of the allowed values"};
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
const err23 = {instancePath:instancePath+"/events/" + i0+"/lastToolName",schemaPath:"#/properties/events/items/properties/lastToolName/type",keyword:"type",params:{type: schema32.properties.events.items.properties.lastToolName.type},message:"must be string,null"};
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
validate31.errors = vErrors;
return errors === 0;
}

export const v22 = validate32;
const schema33 = {"type":"object","properties":{"resultRef":{"type":"string","minLength":1,"maxLength":512,"pattern":"^(?=[\\s\\S]*\\S)[^\\u0000]*$"},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":100000}},"required":["resultRef"],"additionalProperties":false};

function validate32(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate32.errors = vErrors;
return errors === 0;
}

export const v23 = validate33;
const schema34 = {"type":"object","properties":{"text":{"type":"string","maxLength":100000},"nextOffset":{"anyOf":[{"type":"integer","minimum":0},{"type":"null"}]}},"required":["text","nextOffset"],"additionalProperties":false};

function validate33(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate33.errors = vErrors;
return errors === 0;
}

export const v24 = validate34;
const schema35 = {"type":"object","properties":{"taskId":{"type":"string","minLength":1},"execution":{"type":"object","properties":{"id":{"type":"string","minLength":1},"key":{"type":"string","minLength":1},"taskId":{"type":"string","minLength":1},"contextKey":{"type":"string","minLength":1},"contextRef":{"type":"string","minLength":1},"status":{"enum":["queued","running","completed","failed","cancelled","interrupted"]},"sequence":{"type":"integer","minimum":0},"tokens":{"type":"integer","minimum":0},"toolCalls":{"type":"integer","minimum":0},"createdAt":{"type":"integer","minimum":1},"attempt":{"type":"integer","minimum":1},"resultRef":{"type":"string","minLength":1},"error":{"type":"string"}},"required":["id","key","taskId","contextKey","contextRef","status","sequence","tokens","toolCalls","createdAt","attempt"],"additionalProperties":false},"event":{"type":"object","properties":{"eventId":{"type":"string","minLength":1},"executionId":{"type":"string","minLength":1},"sequence":{"type":"integer","minimum":1},"timestamp":{"type":"integer","minimum":1},"type":{"enum":["queued","running","progress","completed","failed","cancelled","interrupted"]},"tokens":{"type":"integer","minimum":0},"toolCalls":{"type":"integer","minimum":0},"lastToolName":{"type":["string","null"]},"error":{"type":"string"}},"required":["eventId","executionId","sequence","timestamp","type"],"additionalProperties":false}},"required":["taskId","execution","event"],"additionalProperties":false};

function validate34(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(func8.call(schema35.properties.execution.properties, key1))){
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
const err28 = {instancePath:instancePath+"/execution/status",schemaPath:"#/properties/execution/properties/status/enum",keyword:"enum",params:{allowedValues: schema35.properties.execution.properties.status.enum},message:"must be equal to one of the allowed values"};
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
if(!(func8.call(schema35.properties.event.properties, key2))){
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
const err57 = {instancePath:instancePath+"/event/type",schemaPath:"#/properties/event/properties/type/enum",keyword:"enum",params:{allowedValues: schema35.properties.event.properties.type.enum},message:"must be equal to one of the allowed values"};
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
const err62 = {instancePath:instancePath+"/event/lastToolName",schemaPath:"#/properties/event/properties/lastToolName/type",keyword:"type",params:{type: schema35.properties.event.properties.lastToolName.type},message:"must be string,null"};
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
validate34.errors = vErrors;
return errors === 0;
}

export const v25 = validate35;
const schema36 = {"type":"object","properties":{},"required":[],"additionalProperties":false};

function validate35(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate35.errors = vErrors;
return errors === 0;
}

export const v26 = validate36;
const schema37 = {"type":"object","properties":{"servers":{"type":"array","maxItems":100,"items":{"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"},"enabled":{"type":"boolean"},"config":{"type":"object","properties":{"type":{"enum":["stdio","http","sse"]},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"env":{"type":"object","additionalProperties":{"type":"string"}},"url":{"type":"string"},"headers":{"type":"object","additionalProperties":{"type":"string"}},"disabledTools":{"type":"array","items":{"type":"string"}},"oauth":{"type":"object","properties":{"clientName":{"type":"string"},"clientId":{"type":"string"},"redirectUri":{"type":"string"},"authorizationServerOrigin":{"type":"string"},"resourceMetadataUrl":{"type":"string"},"authServerMetadataUrl":{"type":"string"},"callbackPort":{"type":"integer","minimum":1,"maximum":65535},"omitRegistrationScope":{"type":"boolean"},"xaa":{"type":"boolean"}},"required":[],"additionalProperties":false}},"required":["type"],"additionalProperties":false},"updatedAt":{"type":"integer","minimum":0},"credentialsMissing":{"type":"boolean"},"check":{"anyOf":[{"type":"object","properties":{"state":{"enum":["connected","needs-auth","authorized","unchecked","failed"]},"tools":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"description":{"type":"string"},"disabled":{"type":"boolean"}},"required":["name","description","disabled"],"additionalProperties":false}},"checkedAt":{"type":"integer","minimum":0},"durationMs":{"type":"number","minimum":0},"truncated":{"type":"boolean"},"error":{"type":"string"},"serverInfo":{"type":"object","properties":{"name":{"type":"string"},"version":{"type":"string"}},"required":["name","version"],"additionalProperties":false}},"required":["state","tools","checkedAt"],"additionalProperties":false},{"type":"null"}]}},"required":["name","enabled","config","updatedAt","credentialsMissing","check"],"additionalProperties":false}},"resetSessionCount":{"type":"integer","minimum":0},"skippedBusySessionCount":{"type":"integer","minimum":0}},"required":["servers"],"additionalProperties":false};
const pattern25 = new RegExp("^[a-zA-Z0-9_-]+$", "u");

function validate36(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern25.test(data2)){
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
const err17 = {instancePath:instancePath+"/servers/" + i0+"/config/type",schemaPath:"#/properties/servers/items/properties/config/properties/type/enum",keyword:"enum",params:{allowedValues: schema37.properties.servers.items.properties.config.properties.type.enum},message:"must be equal to one of the allowed values"};
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
if(!(func8.call(schema37.properties.servers.items.properties.config.properties.oauth.properties, key5))){
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
const err49 = {instancePath:instancePath+"/servers/" + i0+"/check/state",schemaPath:"#/properties/servers/items/properties/check/anyOf/0/properties/state/enum",keyword:"enum",params:{allowedValues: schema37.properties.servers.items.properties.check.anyOf[0].properties.state.enum},message:"must be equal to one of the allowed values"};
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
validate36.errors = vErrors;
return errors === 0;
}

export const v27 = validate37;
const schema38 = {"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"},"previousName":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"},"enabled":{"type":"boolean"},"config":{"type":"object","properties":{"type":{"enum":["stdio","http","sse"]},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"env":{"type":"object","additionalProperties":{"type":"string"}},"url":{"type":"string"},"headers":{"type":"object","additionalProperties":{"type":"string"}},"disabledTools":{"type":"array","items":{"type":"string"}},"oauth":{"type":"object","properties":{"clientName":{"type":"string"},"clientId":{"type":"string"},"redirectUri":{"type":"string"},"authorizationServerOrigin":{"type":"string"},"resourceMetadataUrl":{"type":"string"},"authServerMetadataUrl":{"type":"string"},"callbackPort":{"type":"integer","minimum":1,"maximum":65535},"omitRegistrationScope":{"type":"boolean"},"xaa":{"type":"boolean"}},"required":[],"additionalProperties":false}},"required":[],"additionalProperties":false}},"required":["name","enabled","config"],"additionalProperties":false};

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
if(!pattern25.test(data0)){
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
if(!pattern25.test(data1)){
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
const err14 = {instancePath:instancePath+"/config/type",schemaPath:"#/properties/config/properties/type/enum",keyword:"enum",params:{allowedValues: schema38.properties.config.properties.type.enum},message:"must be equal to one of the allowed values"};
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
if(!(func8.call(schema38.properties.config.properties.oauth.properties, key4))){
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
if(!pattern25.test(data0)){
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
const schema40 = {"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"},"enabled":{"type":"boolean"}},"required":["name","enabled"],"additionalProperties":false};

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
if(!pattern25.test(data0)){
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
if(!pattern25.test(data0)){
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

export const v31 = validate41;
const schema42 = {"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"}},"required":["name"],"additionalProperties":false};

function validate41(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern25.test(data0)){
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
validate41.errors = vErrors;
return errors === 0;
}

export const v32 = validate42;
const schema43 = {"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-zA-Z0-9_-]+$"}},"required":["name"],"additionalProperties":false};

function validate42(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern25.test(data0)){
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
validate42.errors = vErrors;
return errors === 0;
}

export const v33 = validate43;
const schema44 = {"type":"object","properties":{"kind":{"enum":["file","directory"]},"multiple":{"type":"boolean"}},"required":[],"additionalProperties":false};

function validate43(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!((key0 === "kind") || (key0 === "multiple"))){
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
if(data.kind !== undefined){
let data0 = data.kind;
if(!((data0 === "file") || (data0 === "directory"))){
const err1 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema44.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.multiple !== undefined){
if(typeof data.multiple !== "boolean"){
const err2 = {instancePath:instancePath+"/multiple",schemaPath:"#/properties/multiple/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
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
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate43.errors = vErrors;
return errors === 0;
}

export const v34 = validate44;
const schema45 = {"type":"object","properties":{"paths":{"type":"array","items":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"maxItems":100}},"required":["paths"],"additionalProperties":false};
const pattern33 = new RegExp("^[^\\u0000]*\\S[^\\u0000]*$", "u");

function validate44(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.paths === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "paths"},message:"must have required property '"+"paths"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "paths")){
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
if(data.paths !== undefined){
let data0 = data.paths;
if(Array.isArray(data0)){
if(data0.length > 100){
const err2 = {instancePath:instancePath+"/paths",schemaPath:"#/properties/paths/maxItems",keyword:"maxItems",params:{limit: 100},message:"must NOT have more than 100 items"};
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
if(typeof data1 === "string"){
if(func2(data1) > 4096){
const err3 = {instancePath:instancePath+"/paths/" + i0,schemaPath:"#/properties/paths/items/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func2(data1) < 1){
const err4 = {instancePath:instancePath+"/paths/" + i0,schemaPath:"#/properties/paths/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern33.test(data1)){
const err5 = {instancePath:instancePath+"/paths/" + i0,schemaPath:"#/properties/paths/items/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err6 = {instancePath:instancePath+"/paths/" + i0,schemaPath:"#/properties/paths/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
else {
const err7 = {instancePath:instancePath+"/paths",schemaPath:"#/properties/paths/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
validate44.errors = vErrors;
return errors === 0;
}

export const v35 = validate45;
const schema46 = {"type":"object","properties":{"path":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)"}},"required":["path"],"additionalProperties":false};
const pattern34 = new RegExp("^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)", "u");

function validate45(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.path === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "path")){
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
if(data.path !== undefined){
let data0 = data.path;
if(typeof data0 === "string"){
if(func2(data0) > 4096){
const err2 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern34.test(data0)){
const err4 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/pattern",keyword:"pattern",params:{pattern: "^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)"},message:"must match pattern \""+"^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)"+"\""};
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
const err5 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate45.errors = vErrors;
return errors === 0;
}

export const v36 = validate46;
const schema47 = {"type":"object","properties":{"opened":{"const":true}},"required":["opened"],"additionalProperties":false};

function validate46(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.opened === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "opened"},message:"must have required property '"+"opened"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "opened")){
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
if(data.opened !== undefined){
if(true !== data.opened){
const err2 = {instancePath:instancePath+"/opened",schemaPath:"#/properties/opened/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
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
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate46.errors = vErrors;
return errors === 0;
}

export const v37 = validate47;
const schema48 = {"type":"object","properties":{"path":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)"}},"required":["path"],"additionalProperties":false};

function validate47(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.path === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "path")){
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
if(data.path !== undefined){
let data0 = data.path;
if(typeof data0 === "string"){
if(func2(data0) > 4096){
const err2 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern34.test(data0)){
const err4 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/pattern",keyword:"pattern",params:{pattern: "^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)"},message:"must match pattern \""+"^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)"+"\""};
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
const err5 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate47.errors = vErrors;
return errors === 0;
}

export const v38 = validate48;
const schema49 = {"type":"object","properties":{"revealed":{"const":true}},"required":["revealed"],"additionalProperties":false};

function validate48(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.revealed === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revealed"},message:"must have required property '"+"revealed"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "revealed")){
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
if(data.revealed !== undefined){
if(true !== data.revealed){
const err2 = {instancePath:instancePath+"/revealed",schemaPath:"#/properties/revealed/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
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
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate48.errors = vErrors;
return errors === 0;
}

export const v39 = validate49;
const schema50 = {"type":"object","properties":{},"required":[],"additionalProperties":false};

function validate49(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate49.errors = vErrors;
return errors === 0;
}

export const v40 = validate50;
const schema51 = {"type":"object","properties":{"available":{"type":"boolean"},"path":{"anyOf":[{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]},"version":{"anyOf":[{"type":"string"},{"type":"null"}]}},"required":["available","path","version"],"additionalProperties":false};

function validate50(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.available === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "available"},message:"must have required property '"+"available"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.path === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.version === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "available") || (key0 === "path")) || (key0 === "version"))){
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
if(data.available !== undefined){
if(typeof data.available !== "boolean"){
const err4 = {instancePath:instancePath+"/available",schemaPath:"#/properties/available/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.path !== undefined){
let data1 = data.path;
const _errs5 = errors;
let valid1 = false;
const _errs6 = errors;
if(typeof data1 === "string"){
if(func2(data1) > 4096){
const err5 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func2(data1) < 1){
const err6 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern33.test(data1)){
const err7 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
var _valid0 = _errs6 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs8 = errors;
if(data1 !== null){
const err9 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
var _valid0 = _errs8 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err10 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
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
if(data.version !== undefined){
let data2 = data.version;
const _errs11 = errors;
let valid2 = false;
const _errs12 = errors;
if(typeof data2 !== "string"){
const err11 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
var _valid1 = _errs12 === errors;
valid2 = valid2 || _valid1;
if(!valid2){
const _errs14 = errors;
if(data2 !== null){
const err12 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
var _valid1 = _errs14 === errors;
valid2 = valid2 || _valid1;
}
if(!valid2){
const err13 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
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
}
else {
const err14 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
validate50.errors = vErrors;
return errors === 0;
}

export const v41 = validate51;
const schema52 = {"type":"object","properties":{"kind":{"enum":["image","video","audio","file"]},"multiple":{"type":"boolean"}},"required":[],"additionalProperties":false};

function validate51(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!((key0 === "kind") || (key0 === "multiple"))){
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
if(data.kind !== undefined){
let data0 = data.kind;
if(!((((data0 === "image") || (data0 === "video")) || (data0 === "audio")) || (data0 === "file"))){
const err1 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema52.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.multiple !== undefined){
if(typeof data.multiple !== "boolean"){
const err2 = {instancePath:instancePath+"/multiple",schemaPath:"#/properties/multiple/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
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
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate51.errors = vErrors;
return errors === 0;
}

export const v42 = validate52;
const schema53 = {"type":"object","properties":{"files":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":300,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"path":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"size":{"type":"integer","minimum":0,"maximum":104857600},"mediaUrl":{"type":"string","minLength":1,"maxLength":16384,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["name","path","size","mediaUrl"],"additionalProperties":false},"maxItems":100}},"required":["files"],"additionalProperties":false};

function validate52(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.files === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "files"},message:"must have required property '"+"files"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "files")){
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
if(data.files !== undefined){
let data0 = data.files;
if(Array.isArray(data0)){
if(data0.length > 100){
const err2 = {instancePath:instancePath+"/files",schemaPath:"#/properties/files/maxItems",keyword:"maxItems",params:{limit: 100},message:"must NOT have more than 100 items"};
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
const err3 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data1.path === undefined){
const err4 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.size === undefined){
const err5 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "size"},message:"must have required property '"+"size"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.mediaUrl === undefined){
const err6 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "mediaUrl"},message:"must have required property '"+"mediaUrl"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key1 in data1){
if(!((((key1 === "name") || (key1 === "path")) || (key1 === "size")) || (key1 === "mediaUrl"))){
const err7 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data1.name !== undefined){
let data2 = data1.name;
if(typeof data2 === "string"){
if(func2(data2) > 300){
const err8 = {instancePath:instancePath+"/files/" + i0+"/name",schemaPath:"#/properties/files/items/properties/name/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func2(data2) < 1){
const err9 = {instancePath:instancePath+"/files/" + i0+"/name",schemaPath:"#/properties/files/items/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern33.test(data2)){
const err10 = {instancePath:instancePath+"/files/" + i0+"/name",schemaPath:"#/properties/files/items/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err11 = {instancePath:instancePath+"/files/" + i0+"/name",schemaPath:"#/properties/files/items/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data1.path !== undefined){
let data3 = data1.path;
if(typeof data3 === "string"){
if(func2(data3) > 4096){
const err12 = {instancePath:instancePath+"/files/" + i0+"/path",schemaPath:"#/properties/files/items/properties/path/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func2(data3) < 1){
const err13 = {instancePath:instancePath+"/files/" + i0+"/path",schemaPath:"#/properties/files/items/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern33.test(data3)){
const err14 = {instancePath:instancePath+"/files/" + i0+"/path",schemaPath:"#/properties/files/items/properties/path/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err15 = {instancePath:instancePath+"/files/" + i0+"/path",schemaPath:"#/properties/files/items/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data1.size !== undefined){
let data4 = data1.size;
if(!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))){
const err16 = {instancePath:instancePath+"/files/" + i0+"/size",schemaPath:"#/properties/files/items/properties/size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(typeof data4 == "number"){
if(data4 > 104857600 || isNaN(data4)){
const err17 = {instancePath:instancePath+"/files/" + i0+"/size",schemaPath:"#/properties/files/items/properties/size/maximum",keyword:"maximum",params:{comparison: "<=", limit: 104857600},message:"must be <= 104857600"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(data4 < 0 || isNaN(data4)){
const err18 = {instancePath:instancePath+"/files/" + i0+"/size",schemaPath:"#/properties/files/items/properties/size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data1.mediaUrl !== undefined){
let data5 = data1.mediaUrl;
if(typeof data5 === "string"){
if(func2(data5) > 16384){
const err19 = {instancePath:instancePath+"/files/" + i0+"/mediaUrl",schemaPath:"#/properties/files/items/properties/mediaUrl/maxLength",keyword:"maxLength",params:{limit: 16384},message:"must NOT have more than 16384 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(func2(data5) < 1){
const err20 = {instancePath:instancePath+"/files/" + i0+"/mediaUrl",schemaPath:"#/properties/files/items/properties/mediaUrl/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!pattern33.test(data5)){
const err21 = {instancePath:instancePath+"/files/" + i0+"/mediaUrl",schemaPath:"#/properties/files/items/properties/mediaUrl/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err22 = {instancePath:instancePath+"/files/" + i0+"/mediaUrl",schemaPath:"#/properties/files/items/properties/mediaUrl/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
else {
const err23 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err24 = {instancePath:instancePath+"/files",schemaPath:"#/properties/files/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
const err25 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
validate52.errors = vErrors;
return errors === 0;
}

export const v43 = validate53;
const schema54 = {"type":"object","properties":{"fileName":{"type":"string","minLength":1,"maxLength":300,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"dataBase64":{"type":"string","minLength":1,"maxLength":524288,"pattern":"^[A-Za-z0-9+/]+={0,2}$"},"transferId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[a-zA-Z0-9_-]+$"},"offset":{"type":"integer","minimum":0,"maximum":104857600},"complete":{"type":"boolean"}},"required":["fileName","dataBase64"],"additionalProperties":false};
const pattern41 = new RegExp("^[A-Za-z0-9+/]+={0,2}$", "u");

function validate53(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.fileName === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fileName"},message:"must have required property '"+"fileName"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.dataBase64 === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "dataBase64"},message:"must have required property '"+"dataBase64"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "fileName") || (key0 === "dataBase64")) || (key0 === "transferId")) || (key0 === "offset")) || (key0 === "complete"))){
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
if(data.fileName !== undefined){
let data0 = data.fileName;
if(typeof data0 === "string"){
if(func2(data0) > 300){
const err3 = {instancePath:instancePath+"/fileName",schemaPath:"#/properties/fileName/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/fileName",schemaPath:"#/properties/fileName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern33.test(data0)){
const err5 = {instancePath:instancePath+"/fileName",schemaPath:"#/properties/fileName/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err6 = {instancePath:instancePath+"/fileName",schemaPath:"#/properties/fileName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.dataBase64 !== undefined){
let data1 = data.dataBase64;
if(typeof data1 === "string"){
if(func2(data1) > 524288){
const err7 = {instancePath:instancePath+"/dataBase64",schemaPath:"#/properties/dataBase64/maxLength",keyword:"maxLength",params:{limit: 524288},message:"must NOT have more than 524288 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data1) < 1){
const err8 = {instancePath:instancePath+"/dataBase64",schemaPath:"#/properties/dataBase64/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern41.test(data1)){
const err9 = {instancePath:instancePath+"/dataBase64",schemaPath:"#/properties/dataBase64/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9+/]+={0,2}$"},message:"must match pattern \""+"^[A-Za-z0-9+/]+={0,2}$"+"\""};
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
const err10 = {instancePath:instancePath+"/dataBase64",schemaPath:"#/properties/dataBase64/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.transferId !== undefined){
let data2 = data.transferId;
if(typeof data2 === "string"){
if(func2(data2) > 128){
const err11 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func2(data2) < 1){
const err12 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(!pattern25.test(data2)){
const err13 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/pattern",keyword:"pattern",params:{pattern: "^[a-zA-Z0-9_-]+$"},message:"must match pattern \""+"^[a-zA-Z0-9_-]+$"+"\""};
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
const err14 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.offset !== undefined){
let data3 = data.offset;
if(!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))){
const err15 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(typeof data3 == "number"){
if(data3 > 104857600 || isNaN(data3)){
const err16 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/maximum",keyword:"maximum",params:{comparison: "<=", limit: 104857600},message:"must be <= 104857600"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data3 < 0 || isNaN(data3)){
const err17 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.complete !== undefined){
if(typeof data.complete !== "boolean"){
const err18 = {instancePath:instancePath+"/complete",schemaPath:"#/properties/complete/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
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
const err19 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
validate53.errors = vErrors;
return errors === 0;
}

export const v44 = validate54;
const schema55 = {"anyOf":[{"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":300,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"path":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"size":{"type":"integer","minimum":0,"maximum":104857600},"mediaUrl":{"type":"string","minLength":1,"maxLength":16384,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["name","path","size","mediaUrl"],"additionalProperties":false},{"type":"object","properties":{"transferId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"complete":{"const":false},"size":{"type":"integer","minimum":0,"maximum":104857600}},"required":["transferId","complete","size"],"additionalProperties":false}]};

function validate54(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
const _errs0 = errors;
let valid0 = false;
const _errs1 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.name === undefined){
const err0 = {instancePath,schemaPath:"#/anyOf/0/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.path === undefined){
const err1 = {instancePath,schemaPath:"#/anyOf/0/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.size === undefined){
const err2 = {instancePath,schemaPath:"#/anyOf/0/required",keyword:"required",params:{missingProperty: "size"},message:"must have required property '"+"size"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.mediaUrl === undefined){
const err3 = {instancePath,schemaPath:"#/anyOf/0/required",keyword:"required",params:{missingProperty: "mediaUrl"},message:"must have required property '"+"mediaUrl"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "name") || (key0 === "path")) || (key0 === "size")) || (key0 === "mediaUrl"))){
const err4 = {instancePath,schemaPath:"#/anyOf/0/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.name !== undefined){
let data0 = data.name;
if(typeof data0 === "string"){
if(func2(data0) > 300){
const err5 = {instancePath:instancePath+"/name",schemaPath:"#/anyOf/0/properties/name/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func2(data0) < 1){
const err6 = {instancePath:instancePath+"/name",schemaPath:"#/anyOf/0/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern33.test(data0)){
const err7 = {instancePath:instancePath+"/name",schemaPath:"#/anyOf/0/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/name",schemaPath:"#/anyOf/0/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.path !== undefined){
let data1 = data.path;
if(typeof data1 === "string"){
if(func2(data1) > 4096){
const err9 = {instancePath:instancePath+"/path",schemaPath:"#/anyOf/0/properties/path/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func2(data1) < 1){
const err10 = {instancePath:instancePath+"/path",schemaPath:"#/anyOf/0/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(!pattern33.test(data1)){
const err11 = {instancePath:instancePath+"/path",schemaPath:"#/anyOf/0/properties/path/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err12 = {instancePath:instancePath+"/path",schemaPath:"#/anyOf/0/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.size !== undefined){
let data2 = data.size;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err13 = {instancePath:instancePath+"/size",schemaPath:"#/anyOf/0/properties/size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 104857600 || isNaN(data2)){
const err14 = {instancePath:instancePath+"/size",schemaPath:"#/anyOf/0/properties/size/maximum",keyword:"maximum",params:{comparison: "<=", limit: 104857600},message:"must be <= 104857600"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err15 = {instancePath:instancePath+"/size",schemaPath:"#/anyOf/0/properties/size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.mediaUrl !== undefined){
let data3 = data.mediaUrl;
if(typeof data3 === "string"){
if(func2(data3) > 16384){
const err16 = {instancePath:instancePath+"/mediaUrl",schemaPath:"#/anyOf/0/properties/mediaUrl/maxLength",keyword:"maxLength",params:{limit: 16384},message:"must NOT have more than 16384 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func2(data3) < 1){
const err17 = {instancePath:instancePath+"/mediaUrl",schemaPath:"#/anyOf/0/properties/mediaUrl/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern33.test(data3)){
const err18 = {instancePath:instancePath+"/mediaUrl",schemaPath:"#/anyOf/0/properties/mediaUrl/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err19 = {instancePath:instancePath+"/mediaUrl",schemaPath:"#/anyOf/0/properties/mediaUrl/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err20 = {instancePath,schemaPath:"#/anyOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
var _valid0 = _errs1 === errors;
valid0 = valid0 || _valid0;
if(!valid0){
const _errs12 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.transferId === undefined){
const err21 = {instancePath,schemaPath:"#/anyOf/1/required",keyword:"required",params:{missingProperty: "transferId"},message:"must have required property '"+"transferId"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data.complete === undefined){
const err22 = {instancePath,schemaPath:"#/anyOf/1/required",keyword:"required",params:{missingProperty: "complete"},message:"must have required property '"+"complete"+"'"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(data.size === undefined){
const err23 = {instancePath,schemaPath:"#/anyOf/1/required",keyword:"required",params:{missingProperty: "size"},message:"must have required property '"+"size"+"'"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
for(const key1 in data){
if(!(((key1 === "transferId") || (key1 === "complete")) || (key1 === "size"))){
const err24 = {instancePath,schemaPath:"#/anyOf/1/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.transferId !== undefined){
let data4 = data.transferId;
if(typeof data4 === "string"){
if(func2(data4) > 128){
const err25 = {instancePath:instancePath+"/transferId",schemaPath:"#/anyOf/1/properties/transferId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(func2(data4) < 1){
const err26 = {instancePath:instancePath+"/transferId",schemaPath:"#/anyOf/1/properties/transferId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(!pattern33.test(data4)){
const err27 = {instancePath:instancePath+"/transferId",schemaPath:"#/anyOf/1/properties/transferId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err28 = {instancePath:instancePath+"/transferId",schemaPath:"#/anyOf/1/properties/transferId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.complete !== undefined){
if(false !== data.complete){
const err29 = {instancePath:instancePath+"/complete",schemaPath:"#/anyOf/1/properties/complete/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.size !== undefined){
let data6 = data.size;
if(!((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6)))){
const err30 = {instancePath:instancePath+"/size",schemaPath:"#/anyOf/1/properties/size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(typeof data6 == "number"){
if(data6 > 104857600 || isNaN(data6)){
const err31 = {instancePath:instancePath+"/size",schemaPath:"#/anyOf/1/properties/size/maximum",keyword:"maximum",params:{comparison: "<=", limit: 104857600},message:"must be <= 104857600"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err32 = {instancePath:instancePath+"/size",schemaPath:"#/anyOf/1/properties/size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
}
else {
const err33 = {instancePath,schemaPath:"#/anyOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
var _valid0 = _errs12 === errors;
valid0 = valid0 || _valid0;
}
if(!valid0){
const err34 = {instancePath,schemaPath:"#/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate54.errors = vErrors;
return errors === 0;
}

export const v45 = validate55;
const schema56 = {"type":"object","properties":{"path":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"width":{"type":"integer","minimum":1,"maximum":4096},"height":{"type":"integer","minimum":1,"maximum":4096}},"required":["path"],"additionalProperties":false};

function validate55(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.path === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "path") || (key0 === "width")) || (key0 === "height"))){
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
if(data.path !== undefined){
let data0 = data.path;
if(typeof data0 === "string"){
if(func2(data0) > 4096){
const err2 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.width !== undefined){
let data1 = data.width;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err6 = {instancePath:instancePath+"/width",schemaPath:"#/properties/width/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 > 4096 || isNaN(data1)){
const err7 = {instancePath:instancePath+"/width",schemaPath:"#/properties/width/maximum",keyword:"maximum",params:{comparison: "<=", limit: 4096},message:"must be <= 4096"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1 < 1 || isNaN(data1)){
const err8 = {instancePath:instancePath+"/width",schemaPath:"#/properties/width/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data.height !== undefined){
let data2 = data.height;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err9 = {instancePath:instancePath+"/height",schemaPath:"#/properties/height/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 4096 || isNaN(data2)){
const err10 = {instancePath:instancePath+"/height",schemaPath:"#/properties/height/maximum",keyword:"maximum",params:{comparison: "<=", limit: 4096},message:"must be <= 4096"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data2 < 1 || isNaN(data2)){
const err11 = {instancePath:instancePath+"/height",schemaPath:"#/properties/height/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
validate55.errors = vErrors;
return errors === 0;
}

export const v46 = validate56;
const schema57 = {"type":"object","properties":{"path":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"mediaUrl":{"type":"string","minLength":1,"maxLength":16384,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["path","mediaUrl"],"additionalProperties":false};

function validate56(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.path === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.mediaUrl === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mediaUrl"},message:"must have required property '"+"mediaUrl"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "path") || (key0 === "mediaUrl"))){
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
if(data.path !== undefined){
let data0 = data.path;
if(typeof data0 === "string"){
if(func2(data0) > 4096){
const err3 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern33.test(data0)){
const err5 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err6 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.mediaUrl !== undefined){
let data1 = data.mediaUrl;
if(typeof data1 === "string"){
if(func2(data1) > 16384){
const err7 = {instancePath:instancePath+"/mediaUrl",schemaPath:"#/properties/mediaUrl/maxLength",keyword:"maxLength",params:{limit: 16384},message:"must NOT have more than 16384 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data1) < 1){
const err8 = {instancePath:instancePath+"/mediaUrl",schemaPath:"#/properties/mediaUrl/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern33.test(data1)){
const err9 = {instancePath:instancePath+"/mediaUrl",schemaPath:"#/properties/mediaUrl/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err10 = {instancePath:instancePath+"/mediaUrl",schemaPath:"#/properties/mediaUrl/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate56.errors = vErrors;
return errors === 0;
}

export const v47 = validate57;
const schema58 = {"type":"object","properties":{"url":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^https?://[^\\s/]+(?:[/?#][^\\s]*)?$"},"fileName":{"type":"string","minLength":1,"maxLength":300,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["url","fileName"],"additionalProperties":false};
const pattern50 = new RegExp("^https?://[^\\s/]+(?:[/?#][^\\s]*)?$", "u");

function validate57(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.url === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "url"},message:"must have required property '"+"url"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.fileName === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fileName"},message:"must have required property '"+"fileName"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "url") || (key0 === "fileName"))){
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
if(data.url !== undefined){
let data0 = data.url;
if(typeof data0 === "string"){
if(func2(data0) > 4096){
const err3 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern50.test(data0)){
const err5 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/pattern",keyword:"pattern",params:{pattern: "^https?://[^\\s/]+(?:[/?#][^\\s]*)?$"},message:"must match pattern \""+"^https?://[^\\s/]+(?:[/?#][^\\s]*)?$"+"\""};
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
const err6 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.fileName !== undefined){
let data1 = data.fileName;
if(typeof data1 === "string"){
if(func2(data1) > 300){
const err7 = {instancePath:instancePath+"/fileName",schemaPath:"#/properties/fileName/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data1) < 1){
const err8 = {instancePath:instancePath+"/fileName",schemaPath:"#/properties/fileName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern33.test(data1)){
const err9 = {instancePath:instancePath+"/fileName",schemaPath:"#/properties/fileName/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err10 = {instancePath:instancePath+"/fileName",schemaPath:"#/properties/fileName/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate57.errors = vErrors;
return errors === 0;
}

export const v48 = validate58;
const schema59 = {"anyOf":[{"type":"object","properties":{"canceled":{"const":true}},"required":["canceled"],"additionalProperties":false},{"type":"object","properties":{"canceled":{"const":false},"filePath":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["canceled","filePath"],"additionalProperties":false}]};

function validate58(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
const _errs0 = errors;
let valid0 = false;
const _errs1 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.canceled === undefined){
const err0 = {instancePath,schemaPath:"#/anyOf/0/required",keyword:"required",params:{missingProperty: "canceled"},message:"must have required property '"+"canceled"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "canceled")){
const err1 = {instancePath,schemaPath:"#/anyOf/0/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.canceled !== undefined){
if(true !== data.canceled){
const err2 = {instancePath:instancePath+"/canceled",schemaPath:"#/anyOf/0/properties/canceled/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
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
else {
const err3 = {instancePath,schemaPath:"#/anyOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
var _valid0 = _errs1 === errors;
valid0 = valid0 || _valid0;
if(!valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.canceled === undefined){
const err4 = {instancePath,schemaPath:"#/anyOf/1/required",keyword:"required",params:{missingProperty: "canceled"},message:"must have required property '"+"canceled"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.filePath === undefined){
const err5 = {instancePath,schemaPath:"#/anyOf/1/required",keyword:"required",params:{missingProperty: "filePath"},message:"must have required property '"+"filePath"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key1 in data){
if(!((key1 === "canceled") || (key1 === "filePath"))){
const err6 = {instancePath,schemaPath:"#/anyOf/1/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.canceled !== undefined){
if(false !== data.canceled){
const err7 = {instancePath:instancePath+"/canceled",schemaPath:"#/anyOf/1/properties/canceled/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.filePath !== undefined){
let data2 = data.filePath;
if(typeof data2 === "string"){
if(func2(data2) > 4096){
const err8 = {instancePath:instancePath+"/filePath",schemaPath:"#/anyOf/1/properties/filePath/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func2(data2) < 1){
const err9 = {instancePath:instancePath+"/filePath",schemaPath:"#/anyOf/1/properties/filePath/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern33.test(data2)){
const err10 = {instancePath:instancePath+"/filePath",schemaPath:"#/anyOf/1/properties/filePath/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err11 = {instancePath:instancePath+"/filePath",schemaPath:"#/anyOf/1/properties/filePath/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err12 = {instancePath,schemaPath:"#/anyOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
var _valid0 = _errs5 === errors;
valid0 = valid0 || _valid0;
}
if(!valid0){
const err13 = {instancePath,schemaPath:"#/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate58.errors = vErrors;
return errors === 0;
}

export const v49 = validate59;
const schema60 = {"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":300,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"path":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"size":{"type":"integer","minimum":0,"maximum":104857600},"mediaUrl":{"type":"string","minLength":1,"maxLength":16384,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["name","path","size","mediaUrl"],"additionalProperties":false};

function validate59(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(data.path === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.size === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "size"},message:"must have required property '"+"size"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.mediaUrl === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mediaUrl"},message:"must have required property '"+"mediaUrl"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "name") || (key0 === "path")) || (key0 === "size")) || (key0 === "mediaUrl"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.name !== undefined){
let data0 = data.name;
if(typeof data0 === "string"){
if(func2(data0) > 300){
const err5 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func2(data0) < 1){
const err6 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern33.test(data0)){
const err7 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.path !== undefined){
let data1 = data.path;
if(typeof data1 === "string"){
if(func2(data1) > 4096){
const err9 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func2(data1) < 1){
const err10 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(!pattern33.test(data1)){
const err11 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err12 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.size !== undefined){
let data2 = data.size;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err13 = {instancePath:instancePath+"/size",schemaPath:"#/properties/size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 104857600 || isNaN(data2)){
const err14 = {instancePath:instancePath+"/size",schemaPath:"#/properties/size/maximum",keyword:"maximum",params:{comparison: "<=", limit: 104857600},message:"must be <= 104857600"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err15 = {instancePath:instancePath+"/size",schemaPath:"#/properties/size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.mediaUrl !== undefined){
let data3 = data.mediaUrl;
if(typeof data3 === "string"){
if(func2(data3) > 16384){
const err16 = {instancePath:instancePath+"/mediaUrl",schemaPath:"#/properties/mediaUrl/maxLength",keyword:"maxLength",params:{limit: 16384},message:"must NOT have more than 16384 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func2(data3) < 1){
const err17 = {instancePath:instancePath+"/mediaUrl",schemaPath:"#/properties/mediaUrl/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern33.test(data3)){
const err18 = {instancePath:instancePath+"/mediaUrl",schemaPath:"#/properties/mediaUrl/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err19 = {instancePath:instancePath+"/mediaUrl",schemaPath:"#/properties/mediaUrl/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err20 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
validate59.errors = vErrors;
return errors === 0;
}

export const v50 = validate60;
const schema61 = {"type":"object","properties":{"url":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^https?://[^\\s/]+(?:[/?#][^\\s]*)?$"}},"required":["url"],"additionalProperties":false};

function validate60(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.url === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "url"},message:"must have required property '"+"url"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "url")){
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
if(data.url !== undefined){
let data0 = data.url;
if(typeof data0 === "string"){
if(func2(data0) > 4096){
const err2 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern50.test(data0)){
const err4 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/pattern",keyword:"pattern",params:{pattern: "^https?://[^\\s/]+(?:[/?#][^\\s]*)?$"},message:"must match pattern \""+"^https?://[^\\s/]+(?:[/?#][^\\s]*)?$"+"\""};
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
const err5 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate60.errors = vErrors;
return errors === 0;
}

export const v51 = validate61;
const schema62 = {"type":"object","properties":{"opened":{"const":true}},"required":["opened"],"additionalProperties":false};

function validate61(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.opened === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "opened"},message:"must have required property '"+"opened"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "opened")){
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
if(data.opened !== undefined){
if(true !== data.opened){
const err2 = {instancePath:instancePath+"/opened",schemaPath:"#/properties/opened/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
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
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate61.errors = vErrors;
return errors === 0;
}

export const v52 = validate62;
const schema63 = {"type":"object","properties":{"schemaVersion":{"const":1},"capturedAt":{"type":"integer","minimum":0,"maximum":9007199254740991},"sessionCount":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["schemaVersion","capturedAt","sessionCount"],"additionalProperties":false};

function validate62(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.capturedAt === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "capturedAt"},message:"must have required property '"+"capturedAt"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.sessionCount === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sessionCount"},message:"must have required property '"+"sessionCount"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "schemaVersion") || (key0 === "capturedAt")) || (key0 === "sessionCount"))){
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
if(data.schemaVersion !== undefined){
if(1 !== data.schemaVersion){
const err4 = {instancePath:instancePath+"/schemaVersion",schemaPath:"#/properties/schemaVersion/const",keyword:"const",params:{allowedValue: 1},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.capturedAt !== undefined){
let data1 = data.capturedAt;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err5 = {instancePath:instancePath+"/capturedAt",schemaPath:"#/properties/capturedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 > 9007199254740991 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/capturedAt",schemaPath:"#/properties/capturedAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1 < 0 || isNaN(data1)){
const err7 = {instancePath:instancePath+"/capturedAt",schemaPath:"#/properties/capturedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.sessionCount !== undefined){
let data2 = data.sessionCount;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err8 = {instancePath:instancePath+"/sessionCount",schemaPath:"#/properties/sessionCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 9007199254740991 || isNaN(data2)){
const err9 = {instancePath:instancePath+"/sessionCount",schemaPath:"#/properties/sessionCount/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err10 = {instancePath:instancePath+"/sessionCount",schemaPath:"#/properties/sessionCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
validate62.errors = vErrors;
return errors === 0;
}

export const v53 = validate63;
const schema64 = {"type":"object","properties":{"sessionId":{"type":"string","minLength":1,"maxLength":4000,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"toolUseId":{"type":"string","minLength":1,"maxLength":4000,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["sessionId"],"additionalProperties":false};

function validate63(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.sessionId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sessionId"},message:"must have required property '"+"sessionId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "sessionId") || (key0 === "toolUseId"))){
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
if(data.sessionId !== undefined){
let data0 = data.sessionId;
if(typeof data0 === "string"){
if(func2(data0) > 4000){
const err2 = {instancePath:instancePath+"/sessionId",schemaPath:"#/properties/sessionId/maxLength",keyword:"maxLength",params:{limit: 4000},message:"must NOT have more than 4000 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/sessionId",schemaPath:"#/properties/sessionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/sessionId",schemaPath:"#/properties/sessionId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/sessionId",schemaPath:"#/properties/sessionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.toolUseId !== undefined){
let data1 = data.toolUseId;
if(typeof data1 === "string"){
if(func2(data1) > 4000){
const err6 = {instancePath:instancePath+"/toolUseId",schemaPath:"#/properties/toolUseId/maxLength",keyword:"maxLength",params:{limit: 4000},message:"must NOT have more than 4000 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func2(data1) < 1){
const err7 = {instancePath:instancePath+"/toolUseId",schemaPath:"#/properties/toolUseId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern33.test(data1)){
const err8 = {instancePath:instancePath+"/toolUseId",schemaPath:"#/properties/toolUseId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err9 = {instancePath:instancePath+"/toolUseId",schemaPath:"#/properties/toolUseId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate63.errors = vErrors;
return errors === 0;
}

export const v54 = validate64;
const schema65 = {"type":"object","properties":{"opened":{"const":true}},"required":["opened"],"additionalProperties":false};

function validate64(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.opened === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "opened"},message:"must have required property '"+"opened"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "opened")){
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
if(data.opened !== undefined){
if(true !== data.opened){
const err2 = {instancePath:instancePath+"/opened",schemaPath:"#/properties/opened/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
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
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate64.errors = vErrors;
return errors === 0;
}

export const v55 = validate65;
const schema66 = {"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":4000,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"severity":{"enum":["info","warning","error"]},"title":{"type":"string","minLength":1,"maxLength":4000,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"message":{"type":"string","minLength":1,"maxLength":4000,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"details":{"type":"string","minLength":1,"maxLength":16000,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["id","severity","title","message"],"additionalProperties":false};

function validate65(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(data.severity === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "severity"},message:"must have required property '"+"severity"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.title === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.message === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "message"},message:"must have required property '"+"message"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "id") || (key0 === "severity")) || (key0 === "title")) || (key0 === "message")) || (key0 === "details"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(typeof data0 === "string"){
if(func2(data0) > 4000){
const err5 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/maxLength",keyword:"maxLength",params:{limit: 4000},message:"must NOT have more than 4000 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func2(data0) < 1){
const err6 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern33.test(data0)){
const err7 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.severity !== undefined){
let data1 = data.severity;
if(!(((data1 === "info") || (data1 === "warning")) || (data1 === "error"))){
const err9 = {instancePath:instancePath+"/severity",schemaPath:"#/properties/severity/enum",keyword:"enum",params:{allowedValues: schema66.properties.severity.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.title !== undefined){
let data2 = data.title;
if(typeof data2 === "string"){
if(func2(data2) > 4000){
const err10 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/maxLength",keyword:"maxLength",params:{limit: 4000},message:"must NOT have more than 4000 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func2(data2) < 1){
const err11 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!pattern33.test(data2)){
const err12 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err13 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.message !== undefined){
let data3 = data.message;
if(typeof data3 === "string"){
if(func2(data3) > 4000){
const err14 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/maxLength",keyword:"maxLength",params:{limit: 4000},message:"must NOT have more than 4000 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func2(data3) < 1){
const err15 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(!pattern33.test(data3)){
const err16 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err17 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.details !== undefined){
let data4 = data.details;
if(typeof data4 === "string"){
if(func2(data4) > 16000){
const err18 = {instancePath:instancePath+"/details",schemaPath:"#/properties/details/maxLength",keyword:"maxLength",params:{limit: 16000},message:"must NOT have more than 16000 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(func2(data4) < 1){
const err19 = {instancePath:instancePath+"/details",schemaPath:"#/properties/details/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(!pattern33.test(data4)){
const err20 = {instancePath:instancePath+"/details",schemaPath:"#/properties/details/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err21 = {instancePath:instancePath+"/details",schemaPath:"#/properties/details/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err22 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
validate65.errors = vErrors;
return errors === 0;
}

export const v56 = validate66;
const schema67 = {"type":"object","properties":{"delivered":{"const":true}},"required":["delivered"],"additionalProperties":false};

function validate66(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.delivered === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "delivered"},message:"must have required property '"+"delivered"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "delivered")){
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
if(data.delivered !== undefined){
if(true !== data.delivered){
const err2 = {instancePath:instancePath+"/delivered",schemaPath:"#/properties/delivered/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
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
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate66.errors = vErrors;
return errors === 0;
}

export const v57 = validate67;
const schema68 = {"type":"object","properties":{"enabled":{"type":"boolean"},"queuedBytes":{"type":"integer","minimum":0,"maximum":9007199254740991},"droppedRecords":{"type":"integer","minimum":0,"maximum":9007199254740991},"error":{"anyOf":[{"type":"string"},{"type":"null"}]}},"required":["enabled","queuedBytes","droppedRecords","error"],"additionalProperties":false};

function validate67(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.enabled === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "enabled"},message:"must have required property '"+"enabled"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.queuedBytes === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "queuedBytes"},message:"must have required property '"+"queuedBytes"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.droppedRecords === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "droppedRecords"},message:"must have required property '"+"droppedRecords"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.error === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "error"},message:"must have required property '"+"error"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "enabled") || (key0 === "queuedBytes")) || (key0 === "droppedRecords")) || (key0 === "error"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.enabled !== undefined){
if(typeof data.enabled !== "boolean"){
const err5 = {instancePath:instancePath+"/enabled",schemaPath:"#/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.queuedBytes !== undefined){
let data1 = data.queuedBytes;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err6 = {instancePath:instancePath+"/queuedBytes",schemaPath:"#/properties/queuedBytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 > 9007199254740991 || isNaN(data1)){
const err7 = {instancePath:instancePath+"/queuedBytes",schemaPath:"#/properties/queuedBytes/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1 < 0 || isNaN(data1)){
const err8 = {instancePath:instancePath+"/queuedBytes",schemaPath:"#/properties/queuedBytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.droppedRecords !== undefined){
let data2 = data.droppedRecords;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err9 = {instancePath:instancePath+"/droppedRecords",schemaPath:"#/properties/droppedRecords/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 9007199254740991 || isNaN(data2)){
const err10 = {instancePath:instancePath+"/droppedRecords",schemaPath:"#/properties/droppedRecords/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err11 = {instancePath:instancePath+"/droppedRecords",schemaPath:"#/properties/droppedRecords/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.error !== undefined){
let data3 = data.error;
const _errs9 = errors;
let valid1 = false;
const _errs10 = errors;
if(typeof data3 !== "string"){
const err12 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
var _valid0 = _errs10 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs12 = errors;
if(data3 !== null){
const err13 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
var _valid0 = _errs12 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err14 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
else {
errors = _errs9;
if(vErrors !== null){
if(_errs9){
vErrors.length = _errs9;
}
else {
vErrors = null;
}
}
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
validate67.errors = vErrors;
return errors === 0;
}

export const v58 = validate68;
const schema69 = {"type":"object","properties":{},"required":[],"additionalProperties":false};

function validate68(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate68.errors = vErrors;
return errors === 0;
}

export const v59 = validate69;
const schema70 = {"type":"object","properties":{"state":{"enum":["remote_disabled","unauthenticated","unconfigured","disabled","unsupported","unavailable","target_mismatch","forbidden","ready"]},"version":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["state"],"additionalProperties":false};

function validate69(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.state === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "state") || (key0 === "version"))){
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
if(data.state !== undefined){
let data0 = data.state;
if(!(((((((((data0 === "remote_disabled") || (data0 === "unauthenticated")) || (data0 === "unconfigured")) || (data0 === "disabled")) || (data0 === "unsupported")) || (data0 === "unavailable")) || (data0 === "target_mismatch")) || (data0 === "forbidden")) || (data0 === "ready"))){
const err2 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/enum",keyword:"enum",params:{allowedValues: schema70.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.version !== undefined){
let data1 = data.version;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err3 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 > 9007199254740991 || isNaN(data1)){
const err4 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1 < 0 || isNaN(data1)){
const err5 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
validate69.errors = vErrors;
return errors === 0;
}

export const v60 = validate70;
const schema71 = {"type":"object","properties":{"usedBytes":{"type":"integer","minimum":0,"maximum":9007199254740991},"reservedBytes":{"type":"integer","minimum":0,"maximum":9007199254740991},"limitBytes":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["usedBytes","reservedBytes","limitBytes"],"additionalProperties":false};

function validate70(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.usedBytes === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "usedBytes"},message:"must have required property '"+"usedBytes"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.reservedBytes === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "reservedBytes"},message:"must have required property '"+"reservedBytes"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.limitBytes === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "limitBytes"},message:"must have required property '"+"limitBytes"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "usedBytes") || (key0 === "reservedBytes")) || (key0 === "limitBytes"))){
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
if(data.usedBytes !== undefined){
let data0 = data.usedBytes;
if(!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))){
const err4 = {instancePath:instancePath+"/usedBytes",schemaPath:"#/properties/usedBytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(typeof data0 == "number"){
if(data0 > 9007199254740991 || isNaN(data0)){
const err5 = {instancePath:instancePath+"/usedBytes",schemaPath:"#/properties/usedBytes/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data0 < 0 || isNaN(data0)){
const err6 = {instancePath:instancePath+"/usedBytes",schemaPath:"#/properties/usedBytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
if(data.reservedBytes !== undefined){
let data1 = data.reservedBytes;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err7 = {instancePath:instancePath+"/reservedBytes",schemaPath:"#/properties/reservedBytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 > 9007199254740991 || isNaN(data1)){
const err8 = {instancePath:instancePath+"/reservedBytes",schemaPath:"#/properties/reservedBytes/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1 < 0 || isNaN(data1)){
const err9 = {instancePath:instancePath+"/reservedBytes",schemaPath:"#/properties/reservedBytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.limitBytes !== undefined){
let data2 = data.limitBytes;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err10 = {instancePath:instancePath+"/limitBytes",schemaPath:"#/properties/limitBytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 9007199254740991 || isNaN(data2)){
const err11 = {instancePath:instancePath+"/limitBytes",schemaPath:"#/properties/limitBytes/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err12 = {instancePath:instancePath+"/limitBytes",schemaPath:"#/properties/limitBytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
}
else {
const err13 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
validate70.errors = vErrors;
return errors === 0;
}

export const v61 = validate71;
const schema72 = {"type":"object","properties":{"parentId":{"anyOf":[{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]},"cursor":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"limit":{"type":"integer","minimum":1,"maximum":200}},"required":[],"additionalProperties":false};

function validate71(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!(((key0 === "parentId") || (key0 === "cursor")) || (key0 === "limit"))){
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
if(data.parentId !== undefined){
let data0 = data.parentId;
const _errs3 = errors;
let valid1 = false;
const _errs4 = errors;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err1 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(func2(data0) < 1){
const err2 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(!pattern33.test(data0)){
const err3 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err4 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
var _valid0 = _errs4 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs6 = errors;
if(data0 !== null){
const err5 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
var _valid0 = _errs6 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err6 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
else {
errors = _errs3;
if(vErrors !== null){
if(_errs3){
vErrors.length = _errs3;
}
else {
vErrors = null;
}
}
}
}
if(data.cursor !== undefined){
let data1 = data.cursor;
if(typeof data1 === "string"){
if(func2(data1) > 128){
const err7 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data1) < 1){
const err8 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern33.test(data1)){
const err9 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err10 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.limit !== undefined){
let data2 = data.limit;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err11 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 200 || isNaN(data2)){
const err12 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 200},message:"must be <= 200"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data2 < 1 || isNaN(data2)){
const err13 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
}
else {
const err14 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
validate71.errors = vErrors;
return errors === 0;
}

export const v62 = validate72;
const schema73 = {"type":"object","properties":{"files":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"parentId":{"anyOf":[{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]},"name":{"type":"string","minLength":1,"maxLength":255,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"kind":{"enum":["file","folder"]},"size":{"type":"integer","minimum":0,"maximum":9007199254740991},"revision":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"createdAt":{"type":"integer","minimum":0,"maximum":9007199254740991},"updatedAt":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["id","parentId","name","kind","size","revision","createdAt","updatedAt"],"additionalProperties":false},"maxItems":200},"nextCursor":{"anyOf":[{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]}},"required":["files","nextCursor"],"additionalProperties":false};

function validate72(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.files === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "files"},message:"must have required property '"+"files"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.nextCursor === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "nextCursor"},message:"must have required property '"+"nextCursor"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "files") || (key0 === "nextCursor"))){
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
if(data.files !== undefined){
let data0 = data.files;
if(Array.isArray(data0)){
if(data0.length > 200){
const err3 = {instancePath:instancePath+"/files",schemaPath:"#/properties/files/maxItems",keyword:"maxItems",params:{limit: 200},message:"must NOT have more than 200 items"};
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
if(data1.id === undefined){
const err4 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.parentId === undefined){
const err5 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "parentId"},message:"must have required property '"+"parentId"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.name === undefined){
const err6 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.kind === undefined){
const err7 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.size === undefined){
const err8 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "size"},message:"must have required property '"+"size"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1.revision === undefined){
const err9 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data1.createdAt === undefined){
const err10 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data1.updatedAt === undefined){
const err11 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "updatedAt"},message:"must have required property '"+"updatedAt"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
for(const key1 in data1){
if(!((((((((key1 === "id") || (key1 === "parentId")) || (key1 === "name")) || (key1 === "kind")) || (key1 === "size")) || (key1 === "revision")) || (key1 === "createdAt")) || (key1 === "updatedAt"))){
const err12 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data1.id !== undefined){
let data2 = data1.id;
if(typeof data2 === "string"){
if(func2(data2) > 128){
const err13 = {instancePath:instancePath+"/files/" + i0+"/id",schemaPath:"#/properties/files/items/properties/id/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func2(data2) < 1){
const err14 = {instancePath:instancePath+"/files/" + i0+"/id",schemaPath:"#/properties/files/items/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(!pattern33.test(data2)){
const err15 = {instancePath:instancePath+"/files/" + i0+"/id",schemaPath:"#/properties/files/items/properties/id/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err16 = {instancePath:instancePath+"/files/" + i0+"/id",schemaPath:"#/properties/files/items/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data1.parentId !== undefined){
let data3 = data1.parentId;
const _errs10 = errors;
let valid4 = false;
const _errs11 = errors;
if(typeof data3 === "string"){
if(func2(data3) > 128){
const err17 = {instancePath:instancePath+"/files/" + i0+"/parentId",schemaPath:"#/properties/files/items/properties/parentId/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(func2(data3) < 1){
const err18 = {instancePath:instancePath+"/files/" + i0+"/parentId",schemaPath:"#/properties/files/items/properties/parentId/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(!pattern33.test(data3)){
const err19 = {instancePath:instancePath+"/files/" + i0+"/parentId",schemaPath:"#/properties/files/items/properties/parentId/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err20 = {instancePath:instancePath+"/files/" + i0+"/parentId",schemaPath:"#/properties/files/items/properties/parentId/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
var _valid0 = _errs11 === errors;
valid4 = valid4 || _valid0;
if(!valid4){
const _errs13 = errors;
if(data3 !== null){
const err21 = {instancePath:instancePath+"/files/" + i0+"/parentId",schemaPath:"#/properties/files/items/properties/parentId/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
var _valid0 = _errs13 === errors;
valid4 = valid4 || _valid0;
}
if(!valid4){
const err22 = {instancePath:instancePath+"/files/" + i0+"/parentId",schemaPath:"#/properties/files/items/properties/parentId/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
else {
errors = _errs10;
if(vErrors !== null){
if(_errs10){
vErrors.length = _errs10;
}
else {
vErrors = null;
}
}
}
}
if(data1.name !== undefined){
let data4 = data1.name;
if(typeof data4 === "string"){
if(func2(data4) > 255){
const err23 = {instancePath:instancePath+"/files/" + i0+"/name",schemaPath:"#/properties/files/items/properties/name/maxLength",keyword:"maxLength",params:{limit: 255},message:"must NOT have more than 255 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(func2(data4) < 1){
const err24 = {instancePath:instancePath+"/files/" + i0+"/name",schemaPath:"#/properties/files/items/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(!pattern33.test(data4)){
const err25 = {instancePath:instancePath+"/files/" + i0+"/name",schemaPath:"#/properties/files/items/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err26 = {instancePath:instancePath+"/files/" + i0+"/name",schemaPath:"#/properties/files/items/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data1.kind !== undefined){
let data5 = data1.kind;
if(!((data5 === "file") || (data5 === "folder"))){
const err27 = {instancePath:instancePath+"/files/" + i0+"/kind",schemaPath:"#/properties/files/items/properties/kind/enum",keyword:"enum",params:{allowedValues: schema73.properties.files.items.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data1.size !== undefined){
let data6 = data1.size;
if(!((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6)))){
const err28 = {instancePath:instancePath+"/files/" + i0+"/size",schemaPath:"#/properties/files/items/properties/size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(typeof data6 == "number"){
if(data6 > 9007199254740991 || isNaN(data6)){
const err29 = {instancePath:instancePath+"/files/" + i0+"/size",schemaPath:"#/properties/files/items/properties/size/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err30 = {instancePath:instancePath+"/files/" + i0+"/size",schemaPath:"#/properties/files/items/properties/size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data1.revision !== undefined){
let data7 = data1.revision;
if(typeof data7 === "string"){
if(func2(data7) > 128){
const err31 = {instancePath:instancePath+"/files/" + i0+"/revision",schemaPath:"#/properties/files/items/properties/revision/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(func2(data7) < 1){
const err32 = {instancePath:instancePath+"/files/" + i0+"/revision",schemaPath:"#/properties/files/items/properties/revision/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(!pattern33.test(data7)){
const err33 = {instancePath:instancePath+"/files/" + i0+"/revision",schemaPath:"#/properties/files/items/properties/revision/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err34 = {instancePath:instancePath+"/files/" + i0+"/revision",schemaPath:"#/properties/files/items/properties/revision/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
if(data1.createdAt !== undefined){
let data8 = data1.createdAt;
if(!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))){
const err35 = {instancePath:instancePath+"/files/" + i0+"/createdAt",schemaPath:"#/properties/files/items/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(typeof data8 == "number"){
if(data8 > 9007199254740991 || isNaN(data8)){
const err36 = {instancePath:instancePath+"/files/" + i0+"/createdAt",schemaPath:"#/properties/files/items/properties/createdAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(data8 < 0 || isNaN(data8)){
const err37 = {instancePath:instancePath+"/files/" + i0+"/createdAt",schemaPath:"#/properties/files/items/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data1.updatedAt !== undefined){
let data9 = data1.updatedAt;
if(!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))){
const err38 = {instancePath:instancePath+"/files/" + i0+"/updatedAt",schemaPath:"#/properties/files/items/properties/updatedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(typeof data9 == "number"){
if(data9 > 9007199254740991 || isNaN(data9)){
const err39 = {instancePath:instancePath+"/files/" + i0+"/updatedAt",schemaPath:"#/properties/files/items/properties/updatedAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(data9 < 0 || isNaN(data9)){
const err40 = {instancePath:instancePath+"/files/" + i0+"/updatedAt",schemaPath:"#/properties/files/items/properties/updatedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
const err41 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err42 = {instancePath:instancePath+"/files",schemaPath:"#/properties/files/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
if(data.nextCursor !== undefined){
let data10 = data.nextCursor;
const _errs27 = errors;
let valid5 = false;
const _errs28 = errors;
if(typeof data10 === "string"){
if(func2(data10) > 128){
const err43 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if(func2(data10) < 1){
const err44 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
if(!pattern33.test(data10)){
const err45 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
else {
const err46 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
var _valid1 = _errs28 === errors;
valid5 = valid5 || _valid1;
if(!valid5){
const _errs30 = errors;
if(data10 !== null){
const err47 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
var _valid1 = _errs30 === errors;
valid5 = valid5 || _valid1;
}
if(!valid5){
const err48 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
else {
errors = _errs27;
if(vErrors !== null){
if(_errs27){
vErrors.length = _errs27;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err49 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
validate72.errors = vErrors;
return errors === 0;
}

export const v63 = validate73;
const schema74 = {"type":"object","properties":{"fileId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["fileId"],"additionalProperties":false};

function validate73(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.fileId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fileId"},message:"must have required property '"+"fileId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "fileId")){
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
if(data.fileId !== undefined){
let data0 = data.fileId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate73.errors = vErrors;
return errors === 0;
}

export const v64 = validate74;
const schema75 = {"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"parentId":{"anyOf":[{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]},"name":{"type":"string","minLength":1,"maxLength":255,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"kind":{"enum":["file","folder"]},"size":{"type":"integer","minimum":0,"maximum":9007199254740991},"revision":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"createdAt":{"type":"integer","minimum":0,"maximum":9007199254740991},"updatedAt":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["id","parentId","name","kind","size","revision","createdAt","updatedAt"],"additionalProperties":false};

function validate74(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(data.parentId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "parentId"},message:"must have required property '"+"parentId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.name === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.kind === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.size === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "size"},message:"must have required property '"+"size"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.revision === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.createdAt === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.updatedAt === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "updatedAt"},message:"must have required property '"+"updatedAt"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "id") || (key0 === "parentId")) || (key0 === "name")) || (key0 === "kind")) || (key0 === "size")) || (key0 === "revision")) || (key0 === "createdAt")) || (key0 === "updatedAt"))){
const err8 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err9 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func2(data0) < 1){
const err10 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(!pattern33.test(data0)){
const err11 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err12 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.parentId !== undefined){
let data1 = data.parentId;
const _errs5 = errors;
let valid1 = false;
const _errs6 = errors;
if(typeof data1 === "string"){
if(func2(data1) > 128){
const err13 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func2(data1) < 1){
const err14 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(!pattern33.test(data1)){
const err15 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err16 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
var _valid0 = _errs6 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs8 = errors;
if(data1 !== null){
const err17 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
var _valid0 = _errs8 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err18 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
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
if(data.name !== undefined){
let data2 = data.name;
if(typeof data2 === "string"){
if(func2(data2) > 255){
const err19 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 255},message:"must NOT have more than 255 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(func2(data2) < 1){
const err20 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!pattern33.test(data2)){
const err21 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err22 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.kind !== undefined){
let data3 = data.kind;
if(!((data3 === "file") || (data3 === "folder"))){
const err23 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema75.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.size !== undefined){
let data4 = data.size;
if(!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))){
const err24 = {instancePath:instancePath+"/size",schemaPath:"#/properties/size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(typeof data4 == "number"){
if(data4 > 9007199254740991 || isNaN(data4)){
const err25 = {instancePath:instancePath+"/size",schemaPath:"#/properties/size/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(data4 < 0 || isNaN(data4)){
const err26 = {instancePath:instancePath+"/size",schemaPath:"#/properties/size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.revision !== undefined){
let data5 = data.revision;
if(typeof data5 === "string"){
if(func2(data5) > 128){
const err27 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(func2(data5) < 1){
const err28 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(!pattern33.test(data5)){
const err29 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.createdAt !== undefined){
let data6 = data.createdAt;
if(!((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6)))){
const err31 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(typeof data6 == "number"){
if(data6 > 9007199254740991 || isNaN(data6)){
const err32 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err33 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.updatedAt !== undefined){
let data7 = data.updatedAt;
if(!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))){
const err34 = {instancePath:instancePath+"/updatedAt",schemaPath:"#/properties/updatedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(typeof data7 == "number"){
if(data7 > 9007199254740991 || isNaN(data7)){
const err35 = {instancePath:instancePath+"/updatedAt",schemaPath:"#/properties/updatedAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(data7 < 0 || isNaN(data7)){
const err36 = {instancePath:instancePath+"/updatedAt",schemaPath:"#/properties/updatedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
}
else {
const err37 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
validate74.errors = vErrors;
return errors === 0;
}

export const v65 = validate75;
const schema76 = {"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":255,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"parentId":{"anyOf":[{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]}},"required":["name"],"additionalProperties":false};

function validate75(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!((key0 === "name") || (key0 === "parentId"))){
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
if(func2(data0) > 255){
const err2 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 255},message:"must NOT have more than 255 characters"};
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
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
if(data.parentId !== undefined){
let data1 = data.parentId;
const _errs5 = errors;
let valid1 = false;
const _errs6 = errors;
if(typeof data1 === "string"){
if(func2(data1) > 128){
const err6 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func2(data1) < 1){
const err7 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern33.test(data1)){
const err8 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err9 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
var _valid0 = _errs6 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs8 = errors;
if(data1 !== null){
const err10 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
var _valid0 = _errs8 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err11 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
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
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate75.errors = vErrors;
return errors === 0;
}

export const v66 = validate76;
const schema77 = {"type":"object","properties":{"fileId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"name":{"type":"string","minLength":1,"maxLength":255,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"parentId":{"anyOf":[{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]}},"required":["fileId"],"additionalProperties":false};

function validate76(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.fileId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fileId"},message:"must have required property '"+"fileId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "fileId") || (key0 === "name")) || (key0 === "parentId"))){
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
if(data.fileId !== undefined){
let data0 = data.fileId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.name !== undefined){
let data1 = data.name;
if(typeof data1 === "string"){
if(func2(data1) > 255){
const err6 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 255},message:"must NOT have more than 255 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func2(data1) < 1){
const err7 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern33.test(data1)){
const err8 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err9 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.parentId !== undefined){
let data2 = data.parentId;
const _errs7 = errors;
let valid1 = false;
const _errs8 = errors;
if(typeof data2 === "string"){
if(func2(data2) > 128){
const err10 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func2(data2) < 1){
const err11 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!pattern33.test(data2)){
const err12 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err13 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
var _valid0 = _errs8 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs10 = errors;
if(data2 !== null){
const err14 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
var _valid0 = _errs10 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err15 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
else {
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
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
validate76.errors = vErrors;
return errors === 0;
}

export const v67 = validate77;
const schema78 = {"type":"object","properties":{"fileId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["fileId"],"additionalProperties":false};

function validate77(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.fileId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fileId"},message:"must have required property '"+"fileId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "fileId")){
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
if(data.fileId !== undefined){
let data0 = data.fileId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate77.errors = vErrors;
return errors === 0;
}

export const v68 = validate78;
const schema79 = {"type":"object","properties":{"ok":{"const":true}},"required":["ok"],"additionalProperties":false};

function validate78(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.ok === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "ok"},message:"must have required property '"+"ok"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "ok")){
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
if(data.ok !== undefined){
if(true !== data.ok){
const err2 = {instancePath:instancePath+"/ok",schemaPath:"#/properties/ok/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
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
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate78.errors = vErrors;
return errors === 0;
}

export const v69 = validate79;
const schema80 = {"type":"object","properties":{"files":{"type":"array","items":{"type":"object","properties":{"handle":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"name":{"type":"string","minLength":1,"maxLength":255,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"size":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["handle","name","size"],"additionalProperties":false},"maxItems":100}},"required":["files"],"additionalProperties":false};

function validate79(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.files === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "files"},message:"must have required property '"+"files"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "files")){
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
if(data.files !== undefined){
let data0 = data.files;
if(Array.isArray(data0)){
if(data0.length > 100){
const err2 = {instancePath:instancePath+"/files",schemaPath:"#/properties/files/maxItems",keyword:"maxItems",params:{limit: 100},message:"must NOT have more than 100 items"};
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
if(data1.handle === undefined){
const err3 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "handle"},message:"must have required property '"+"handle"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data1.name === undefined){
const err4 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.size === undefined){
const err5 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/required",keyword:"required",params:{missingProperty: "size"},message:"must have required property '"+"size"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key1 in data1){
if(!(((key1 === "handle") || (key1 === "name")) || (key1 === "size"))){
const err6 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data1.handle !== undefined){
let data2 = data1.handle;
if(typeof data2 === "string"){
if(func2(data2) > 128){
const err7 = {instancePath:instancePath+"/files/" + i0+"/handle",schemaPath:"#/properties/files/items/properties/handle/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data2) < 1){
const err8 = {instancePath:instancePath+"/files/" + i0+"/handle",schemaPath:"#/properties/files/items/properties/handle/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern33.test(data2)){
const err9 = {instancePath:instancePath+"/files/" + i0+"/handle",schemaPath:"#/properties/files/items/properties/handle/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err10 = {instancePath:instancePath+"/files/" + i0+"/handle",schemaPath:"#/properties/files/items/properties/handle/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data1.name !== undefined){
let data3 = data1.name;
if(typeof data3 === "string"){
if(func2(data3) > 255){
const err11 = {instancePath:instancePath+"/files/" + i0+"/name",schemaPath:"#/properties/files/items/properties/name/maxLength",keyword:"maxLength",params:{limit: 255},message:"must NOT have more than 255 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func2(data3) < 1){
const err12 = {instancePath:instancePath+"/files/" + i0+"/name",schemaPath:"#/properties/files/items/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(!pattern33.test(data3)){
const err13 = {instancePath:instancePath+"/files/" + i0+"/name",schemaPath:"#/properties/files/items/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err14 = {instancePath:instancePath+"/files/" + i0+"/name",schemaPath:"#/properties/files/items/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data1.size !== undefined){
let data4 = data1.size;
if(!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))){
const err15 = {instancePath:instancePath+"/files/" + i0+"/size",schemaPath:"#/properties/files/items/properties/size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(typeof data4 == "number"){
if(data4 > 9007199254740991 || isNaN(data4)){
const err16 = {instancePath:instancePath+"/files/" + i0+"/size",schemaPath:"#/properties/files/items/properties/size/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data4 < 0 || isNaN(data4)){
const err17 = {instancePath:instancePath+"/files/" + i0+"/size",schemaPath:"#/properties/files/items/properties/size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
}
else {
const err18 = {instancePath:instancePath+"/files/" + i0,schemaPath:"#/properties/files/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err19 = {instancePath:instancePath+"/files",schemaPath:"#/properties/files/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
const err20 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
validate79.errors = vErrors;
return errors === 0;
}

export const v70 = validate80;
const schema81 = {"type":"object","properties":{"handle":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"name":{"type":"string","minLength":1,"maxLength":255,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"parentId":{"anyOf":[{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]}},"required":["handle"],"additionalProperties":false};

function validate80(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.handle === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "handle"},message:"must have required property '"+"handle"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "handle") || (key0 === "name")) || (key0 === "parentId"))){
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
if(data.handle !== undefined){
let data0 = data.handle;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/handle",schemaPath:"#/properties/handle/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/handle",schemaPath:"#/properties/handle/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/handle",schemaPath:"#/properties/handle/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/handle",schemaPath:"#/properties/handle/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.name !== undefined){
let data1 = data.name;
if(typeof data1 === "string"){
if(func2(data1) > 255){
const err6 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 255},message:"must NOT have more than 255 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func2(data1) < 1){
const err7 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern33.test(data1)){
const err8 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err9 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.parentId !== undefined){
let data2 = data.parentId;
const _errs7 = errors;
let valid1 = false;
const _errs8 = errors;
if(typeof data2 === "string"){
if(func2(data2) > 128){
const err10 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func2(data2) < 1){
const err11 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!pattern33.test(data2)){
const err12 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err13 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
var _valid0 = _errs8 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs10 = errors;
if(data2 !== null){
const err14 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
var _valid0 = _errs10 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err15 = {instancePath:instancePath+"/parentId",schemaPath:"#/properties/parentId/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
else {
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
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
validate80.errors = vErrors;
return errors === 0;
}

export const v71 = validate81;
const schema82 = {"type":"object","properties":{"transferId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["transferId"],"additionalProperties":false};

function validate81(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.transferId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "transferId"},message:"must have required property '"+"transferId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "transferId")){
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
if(data.transferId !== undefined){
let data0 = data.transferId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate81.errors = vErrors;
return errors === 0;
}

export const v72 = validate82;
const schema83 = {"type":"object","properties":{"fileId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["fileId"],"additionalProperties":false};

function validate82(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.fileId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fileId"},message:"must have required property '"+"fileId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "fileId")){
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
if(data.fileId !== undefined){
let data0 = data.fileId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate82.errors = vErrors;
return errors === 0;
}

export const v73 = validate83;
const schema84 = {"type":"object","properties":{"transferId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["transferId"],"additionalProperties":false};

function validate83(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.transferId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "transferId"},message:"must have required property '"+"transferId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "transferId")){
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
if(data.transferId !== undefined){
let data0 = data.transferId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate83.errors = vErrors;
return errors === 0;
}

export const v74 = validate84;
const schema85 = {"type":"object","properties":{"cursor":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"limit":{"type":"integer","minimum":1,"maximum":200}},"required":[],"additionalProperties":false};

function validate84(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!((key0 === "cursor") || (key0 === "limit"))){
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
if(data.cursor !== undefined){
let data0 = data.cursor;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err1 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(func2(data0) < 1){
const err2 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(!pattern33.test(data0)){
const err3 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err4 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.limit !== undefined){
let data1 = data.limit;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err5 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 > 200 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 200},message:"must be <= 200"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1 < 1 || isNaN(data1)){
const err7 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
validate84.errors = vErrors;
return errors === 0;
}

export const v75 = validate85;
const schema86 = {"type":"object","properties":{"transfers":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"transferId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"direction":{"enum":["upload","download"]},"name":{"type":"string","minLength":1,"maxLength":255,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"fileId":{"anyOf":[{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]},"state":{"enum":["queued","running","paused","cancelled","completed"]},"totalBytes":{"type":"integer","minimum":0,"maximum":9007199254740991},"transferredBytes":{"type":"integer","minimum":0,"maximum":9007199254740991},"error":{"anyOf":[{"type":"string"},{"type":"null"}]},"createdAt":{"type":"integer","minimum":0,"maximum":9007199254740991},"updatedAt":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["id","transferId","direction","name","fileId","state","totalBytes","transferredBytes","error","createdAt","updatedAt"],"additionalProperties":false},"maxItems":200},"nextCursor":{"anyOf":[{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]}},"required":["transfers","nextCursor"],"additionalProperties":false};

function validate85(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.transfers === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "transfers"},message:"must have required property '"+"transfers"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.nextCursor === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "nextCursor"},message:"must have required property '"+"nextCursor"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "transfers") || (key0 === "nextCursor"))){
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
if(data.transfers !== undefined){
let data0 = data.transfers;
if(Array.isArray(data0)){
if(data0.length > 200){
const err3 = {instancePath:instancePath+"/transfers",schemaPath:"#/properties/transfers/maxItems",keyword:"maxItems",params:{limit: 200},message:"must NOT have more than 200 items"};
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
if(data1.id === undefined){
const err4 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.transferId === undefined){
const err5 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/required",keyword:"required",params:{missingProperty: "transferId"},message:"must have required property '"+"transferId"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.direction === undefined){
const err6 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/required",keyword:"required",params:{missingProperty: "direction"},message:"must have required property '"+"direction"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.name === undefined){
const err7 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.fileId === undefined){
const err8 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/required",keyword:"required",params:{missingProperty: "fileId"},message:"must have required property '"+"fileId"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1.state === undefined){
const err9 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data1.totalBytes === undefined){
const err10 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/required",keyword:"required",params:{missingProperty: "totalBytes"},message:"must have required property '"+"totalBytes"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data1.transferredBytes === undefined){
const err11 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/required",keyword:"required",params:{missingProperty: "transferredBytes"},message:"must have required property '"+"transferredBytes"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data1.error === undefined){
const err12 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/required",keyword:"required",params:{missingProperty: "error"},message:"must have required property '"+"error"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data1.createdAt === undefined){
const err13 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data1.updatedAt === undefined){
const err14 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/required",keyword:"required",params:{missingProperty: "updatedAt"},message:"must have required property '"+"updatedAt"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
for(const key1 in data1){
if(!(func8.call(schema86.properties.transfers.items.properties, key1))){
const err15 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data1.id !== undefined){
let data2 = data1.id;
if(typeof data2 === "string"){
if(func2(data2) > 128){
const err16 = {instancePath:instancePath+"/transfers/" + i0+"/id",schemaPath:"#/properties/transfers/items/properties/id/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func2(data2) < 1){
const err17 = {instancePath:instancePath+"/transfers/" + i0+"/id",schemaPath:"#/properties/transfers/items/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern33.test(data2)){
const err18 = {instancePath:instancePath+"/transfers/" + i0+"/id",schemaPath:"#/properties/transfers/items/properties/id/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err19 = {instancePath:instancePath+"/transfers/" + i0+"/id",schemaPath:"#/properties/transfers/items/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data1.transferId !== undefined){
let data3 = data1.transferId;
if(typeof data3 === "string"){
if(func2(data3) > 128){
const err20 = {instancePath:instancePath+"/transfers/" + i0+"/transferId",schemaPath:"#/properties/transfers/items/properties/transferId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(func2(data3) < 1){
const err21 = {instancePath:instancePath+"/transfers/" + i0+"/transferId",schemaPath:"#/properties/transfers/items/properties/transferId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(!pattern33.test(data3)){
const err22 = {instancePath:instancePath+"/transfers/" + i0+"/transferId",schemaPath:"#/properties/transfers/items/properties/transferId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err23 = {instancePath:instancePath+"/transfers/" + i0+"/transferId",schemaPath:"#/properties/transfers/items/properties/transferId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data1.direction !== undefined){
let data4 = data1.direction;
if(!((data4 === "upload") || (data4 === "download"))){
const err24 = {instancePath:instancePath+"/transfers/" + i0+"/direction",schemaPath:"#/properties/transfers/items/properties/direction/enum",keyword:"enum",params:{allowedValues: schema86.properties.transfers.items.properties.direction.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data1.name !== undefined){
let data5 = data1.name;
if(typeof data5 === "string"){
if(func2(data5) > 255){
const err25 = {instancePath:instancePath+"/transfers/" + i0+"/name",schemaPath:"#/properties/transfers/items/properties/name/maxLength",keyword:"maxLength",params:{limit: 255},message:"must NOT have more than 255 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(func2(data5) < 1){
const err26 = {instancePath:instancePath+"/transfers/" + i0+"/name",schemaPath:"#/properties/transfers/items/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(!pattern33.test(data5)){
const err27 = {instancePath:instancePath+"/transfers/" + i0+"/name",schemaPath:"#/properties/transfers/items/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err28 = {instancePath:instancePath+"/transfers/" + i0+"/name",schemaPath:"#/properties/transfers/items/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data1.fileId !== undefined){
let data6 = data1.fileId;
const _errs15 = errors;
let valid4 = false;
const _errs16 = errors;
if(typeof data6 === "string"){
if(func2(data6) > 128){
const err29 = {instancePath:instancePath+"/transfers/" + i0+"/fileId",schemaPath:"#/properties/transfers/items/properties/fileId/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(func2(data6) < 1){
const err30 = {instancePath:instancePath+"/transfers/" + i0+"/fileId",schemaPath:"#/properties/transfers/items/properties/fileId/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(!pattern33.test(data6)){
const err31 = {instancePath:instancePath+"/transfers/" + i0+"/fileId",schemaPath:"#/properties/transfers/items/properties/fileId/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
else {
const err32 = {instancePath:instancePath+"/transfers/" + i0+"/fileId",schemaPath:"#/properties/transfers/items/properties/fileId/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
var _valid0 = _errs16 === errors;
valid4 = valid4 || _valid0;
if(!valid4){
const _errs18 = errors;
if(data6 !== null){
const err33 = {instancePath:instancePath+"/transfers/" + i0+"/fileId",schemaPath:"#/properties/transfers/items/properties/fileId/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
var _valid0 = _errs18 === errors;
valid4 = valid4 || _valid0;
}
if(!valid4){
const err34 = {instancePath:instancePath+"/transfers/" + i0+"/fileId",schemaPath:"#/properties/transfers/items/properties/fileId/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
else {
errors = _errs15;
if(vErrors !== null){
if(_errs15){
vErrors.length = _errs15;
}
else {
vErrors = null;
}
}
}
}
if(data1.state !== undefined){
let data7 = data1.state;
if(!(((((data7 === "queued") || (data7 === "running")) || (data7 === "paused")) || (data7 === "cancelled")) || (data7 === "completed"))){
const err35 = {instancePath:instancePath+"/transfers/" + i0+"/state",schemaPath:"#/properties/transfers/items/properties/state/enum",keyword:"enum",params:{allowedValues: schema86.properties.transfers.items.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data1.totalBytes !== undefined){
let data8 = data1.totalBytes;
if(!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))){
const err36 = {instancePath:instancePath+"/transfers/" + i0+"/totalBytes",schemaPath:"#/properties/transfers/items/properties/totalBytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(typeof data8 == "number"){
if(data8 > 9007199254740991 || isNaN(data8)){
const err37 = {instancePath:instancePath+"/transfers/" + i0+"/totalBytes",schemaPath:"#/properties/transfers/items/properties/totalBytes/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(data8 < 0 || isNaN(data8)){
const err38 = {instancePath:instancePath+"/transfers/" + i0+"/totalBytes",schemaPath:"#/properties/transfers/items/properties/totalBytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data1.transferredBytes !== undefined){
let data9 = data1.transferredBytes;
if(!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))){
const err39 = {instancePath:instancePath+"/transfers/" + i0+"/transferredBytes",schemaPath:"#/properties/transfers/items/properties/transferredBytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(typeof data9 == "number"){
if(data9 > 9007199254740991 || isNaN(data9)){
const err40 = {instancePath:instancePath+"/transfers/" + i0+"/transferredBytes",schemaPath:"#/properties/transfers/items/properties/transferredBytes/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
if(data9 < 0 || isNaN(data9)){
const err41 = {instancePath:instancePath+"/transfers/" + i0+"/transferredBytes",schemaPath:"#/properties/transfers/items/properties/transferredBytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data1.error !== undefined){
let data10 = data1.error;
const _errs26 = errors;
let valid5 = false;
const _errs27 = errors;
if(typeof data10 !== "string"){
const err42 = {instancePath:instancePath+"/transfers/" + i0+"/error",schemaPath:"#/properties/transfers/items/properties/error/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
var _valid1 = _errs27 === errors;
valid5 = valid5 || _valid1;
if(!valid5){
const _errs29 = errors;
if(data10 !== null){
const err43 = {instancePath:instancePath+"/transfers/" + i0+"/error",schemaPath:"#/properties/transfers/items/properties/error/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
var _valid1 = _errs29 === errors;
valid5 = valid5 || _valid1;
}
if(!valid5){
const err44 = {instancePath:instancePath+"/transfers/" + i0+"/error",schemaPath:"#/properties/transfers/items/properties/error/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
else {
errors = _errs26;
if(vErrors !== null){
if(_errs26){
vErrors.length = _errs26;
}
else {
vErrors = null;
}
}
}
}
if(data1.createdAt !== undefined){
let data11 = data1.createdAt;
if(!((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11)))){
const err45 = {instancePath:instancePath+"/transfers/" + i0+"/createdAt",schemaPath:"#/properties/transfers/items/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if(typeof data11 == "number"){
if(data11 > 9007199254740991 || isNaN(data11)){
const err46 = {instancePath:instancePath+"/transfers/" + i0+"/createdAt",schemaPath:"#/properties/transfers/items/properties/createdAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if(data11 < 0 || isNaN(data11)){
const err47 = {instancePath:instancePath+"/transfers/" + i0+"/createdAt",schemaPath:"#/properties/transfers/items/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data1.updatedAt !== undefined){
let data12 = data1.updatedAt;
if(!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))){
const err48 = {instancePath:instancePath+"/transfers/" + i0+"/updatedAt",schemaPath:"#/properties/transfers/items/properties/updatedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
if(typeof data12 == "number"){
if(data12 > 9007199254740991 || isNaN(data12)){
const err49 = {instancePath:instancePath+"/transfers/" + i0+"/updatedAt",schemaPath:"#/properties/transfers/items/properties/updatedAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
if(data12 < 0 || isNaN(data12)){
const err50 = {instancePath:instancePath+"/transfers/" + i0+"/updatedAt",schemaPath:"#/properties/transfers/items/properties/updatedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
}
}
else {
const err51 = {instancePath:instancePath+"/transfers/" + i0,schemaPath:"#/properties/transfers/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
else {
const err52 = {instancePath:instancePath+"/transfers",schemaPath:"#/properties/transfers/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
if(data.nextCursor !== undefined){
let data13 = data.nextCursor;
const _errs36 = errors;
let valid6 = false;
const _errs37 = errors;
if(typeof data13 === "string"){
if(func2(data13) > 128){
const err53 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
if(func2(data13) < 1){
const err54 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
if(!pattern33.test(data13)){
const err55 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
else {
const err56 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
var _valid2 = _errs37 === errors;
valid6 = valid6 || _valid2;
if(!valid6){
const _errs39 = errors;
if(data13 !== null){
const err57 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
var _valid2 = _errs39 === errors;
valid6 = valid6 || _valid2;
}
if(!valid6){
const err58 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
else {
errors = _errs36;
if(vErrors !== null){
if(_errs36){
vErrors.length = _errs36;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err59 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
validate85.errors = vErrors;
return errors === 0;
}

export const v76 = validate86;
const schema87 = {"type":"object","properties":{"transferId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["transferId"],"additionalProperties":false};

function validate86(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.transferId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "transferId"},message:"must have required property '"+"transferId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "transferId")){
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
if(data.transferId !== undefined){
let data0 = data.transferId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate86.errors = vErrors;
return errors === 0;
}

export const v77 = validate87;
const schema88 = {"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"transferId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"direction":{"enum":["upload","download"]},"name":{"type":"string","minLength":1,"maxLength":255,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"fileId":{"anyOf":[{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]},"state":{"enum":["queued","running","paused","cancelled","completed"]},"totalBytes":{"type":"integer","minimum":0,"maximum":9007199254740991},"transferredBytes":{"type":"integer","minimum":0,"maximum":9007199254740991},"error":{"anyOf":[{"type":"string"},{"type":"null"}]},"createdAt":{"type":"integer","minimum":0,"maximum":9007199254740991},"updatedAt":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["id","transferId","direction","name","fileId","state","totalBytes","transferredBytes","error","createdAt","updatedAt"],"additionalProperties":false};

function validate87(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(data.transferId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "transferId"},message:"must have required property '"+"transferId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.direction === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "direction"},message:"must have required property '"+"direction"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.name === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.fileId === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fileId"},message:"must have required property '"+"fileId"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.state === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.totalBytes === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "totalBytes"},message:"must have required property '"+"totalBytes"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.transferredBytes === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "transferredBytes"},message:"must have required property '"+"transferredBytes"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.error === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "error"},message:"must have required property '"+"error"+"'"};
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
if(data.updatedAt === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "updatedAt"},message:"must have required property '"+"updatedAt"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
for(const key0 in data){
if(!(func8.call(schema88.properties, key0))){
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
if(func2(data0) > 128){
const err12 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func2(data0) < 1){
const err13 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern33.test(data0)){
const err14 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err15 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.transferId !== undefined){
let data1 = data.transferId;
if(typeof data1 === "string"){
if(func2(data1) > 128){
const err16 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func2(data1) < 1){
const err17 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern33.test(data1)){
const err18 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err19 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.direction !== undefined){
let data2 = data.direction;
if(!((data2 === "upload") || (data2 === "download"))){
const err20 = {instancePath:instancePath+"/direction",schemaPath:"#/properties/direction/enum",keyword:"enum",params:{allowedValues: schema88.properties.direction.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.name !== undefined){
let data3 = data.name;
if(typeof data3 === "string"){
if(func2(data3) > 255){
const err21 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 255},message:"must NOT have more than 255 characters"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(func2(data3) < 1){
const err22 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(!pattern33.test(data3)){
const err23 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err24 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.fileId !== undefined){
let data4 = data.fileId;
const _errs10 = errors;
let valid1 = false;
const _errs11 = errors;
if(typeof data4 === "string"){
if(func2(data4) > 128){
const err25 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(func2(data4) < 1){
const err26 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(!pattern33.test(data4)){
const err27 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err28 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
var _valid0 = _errs11 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs13 = errors;
if(data4 !== null){
const err29 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
var _valid0 = _errs13 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err30 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
else {
errors = _errs10;
if(vErrors !== null){
if(_errs10){
vErrors.length = _errs10;
}
else {
vErrors = null;
}
}
}
}
if(data.state !== undefined){
let data5 = data.state;
if(!(((((data5 === "queued") || (data5 === "running")) || (data5 === "paused")) || (data5 === "cancelled")) || (data5 === "completed"))){
const err31 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/enum",keyword:"enum",params:{allowedValues: schema88.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data.totalBytes !== undefined){
let data6 = data.totalBytes;
if(!((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6)))){
const err32 = {instancePath:instancePath+"/totalBytes",schemaPath:"#/properties/totalBytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(typeof data6 == "number"){
if(data6 > 9007199254740991 || isNaN(data6)){
const err33 = {instancePath:instancePath+"/totalBytes",schemaPath:"#/properties/totalBytes/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err34 = {instancePath:instancePath+"/totalBytes",schemaPath:"#/properties/totalBytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.transferredBytes !== undefined){
let data7 = data.transferredBytes;
if(!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))){
const err35 = {instancePath:instancePath+"/transferredBytes",schemaPath:"#/properties/transferredBytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(typeof data7 == "number"){
if(data7 > 9007199254740991 || isNaN(data7)){
const err36 = {instancePath:instancePath+"/transferredBytes",schemaPath:"#/properties/transferredBytes/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(data7 < 0 || isNaN(data7)){
const err37 = {instancePath:instancePath+"/transferredBytes",schemaPath:"#/properties/transferredBytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.error !== undefined){
let data8 = data.error;
const _errs21 = errors;
let valid2 = false;
const _errs22 = errors;
if(typeof data8 !== "string"){
const err38 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
var _valid1 = _errs22 === errors;
valid2 = valid2 || _valid1;
if(!valid2){
const _errs24 = errors;
if(data8 !== null){
const err39 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
var _valid1 = _errs24 === errors;
valid2 = valid2 || _valid1;
}
if(!valid2){
const err40 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
else {
errors = _errs21;
if(vErrors !== null){
if(_errs21){
vErrors.length = _errs21;
}
else {
vErrors = null;
}
}
}
}
if(data.createdAt !== undefined){
let data9 = data.createdAt;
if(!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))){
const err41 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
if(typeof data9 == "number"){
if(data9 > 9007199254740991 || isNaN(data9)){
const err42 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(data9 < 0 || isNaN(data9)){
const err43 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.updatedAt !== undefined){
let data10 = data.updatedAt;
if(!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))){
const err44 = {instancePath:instancePath+"/updatedAt",schemaPath:"#/properties/updatedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
if(typeof data10 == "number"){
if(data10 > 9007199254740991 || isNaN(data10)){
const err45 = {instancePath:instancePath+"/updatedAt",schemaPath:"#/properties/updatedAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if(data10 < 0 || isNaN(data10)){
const err46 = {instancePath:instancePath+"/updatedAt",schemaPath:"#/properties/updatedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
const err47 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
validate87.errors = vErrors;
return errors === 0;
}

export const v78 = validate88;
const schema89 = {"type":"object","properties":{"transferId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["transferId"],"additionalProperties":false};

function validate88(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.transferId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "transferId"},message:"must have required property '"+"transferId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "transferId")){
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
if(data.transferId !== undefined){
let data0 = data.transferId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate88.errors = vErrors;
return errors === 0;
}

export const v79 = validate89;
const schema90 = {"type":"object","properties":{"transferId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["transferId"],"additionalProperties":false};

function validate89(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.transferId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "transferId"},message:"must have required property '"+"transferId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "transferId")){
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
if(data.transferId !== undefined){
let data0 = data.transferId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate89.errors = vErrors;
return errors === 0;
}

export const v80 = validate90;
const schema91 = {"type":"object","properties":{"transferId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["transferId"],"additionalProperties":false};

function validate90(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.transferId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "transferId"},message:"must have required property '"+"transferId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "transferId")){
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
if(data.transferId !== undefined){
let data0 = data.transferId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/transferId",schemaPath:"#/properties/transferId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate90.errors = vErrors;
return errors === 0;
}

export const v81 = validate91;
const schema92 = {"type":"object","properties":{"fileId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"requestKey":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"expiresAt":{"anyOf":[{"type":"integer","minimum":1,"maximum":9007199254740991},{"type":"null"}]},"accessCode":{"anyOf":[{"type":"string","pattern":"^[a-zA-Z0-9]{4,12}$"},{"type":"null"}]}},"required":["fileId","requestKey","expiresAt"],"additionalProperties":false};
const pattern105 = new RegExp("^[a-zA-Z0-9]{4,12}$", "u");

function validate91(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.fileId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fileId"},message:"must have required property '"+"fileId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestKey === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestKey"},message:"must have required property '"+"requestKey"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.expiresAt === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expiresAt"},message:"must have required property '"+"expiresAt"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "fileId") || (key0 === "requestKey")) || (key0 === "expiresAt")) || (key0 === "accessCode"))){
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
if(data.fileId !== undefined){
let data0 = data.fileId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err4 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func2(data0) < 1){
const err5 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern33.test(data0)){
const err6 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err7 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.requestKey !== undefined){
let data1 = data.requestKey;
if(typeof data1 === "string"){
if(func2(data1) > 128){
const err8 = {instancePath:instancePath+"/requestKey",schemaPath:"#/properties/requestKey/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func2(data1) < 1){
const err9 = {instancePath:instancePath+"/requestKey",schemaPath:"#/properties/requestKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern33.test(data1)){
const err10 = {instancePath:instancePath+"/requestKey",schemaPath:"#/properties/requestKey/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err11 = {instancePath:instancePath+"/requestKey",schemaPath:"#/properties/requestKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.expiresAt !== undefined){
let data2 = data.expiresAt;
const _errs7 = errors;
let valid1 = false;
const _errs8 = errors;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err12 = {instancePath:instancePath+"/expiresAt",schemaPath:"#/properties/expiresAt/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 9007199254740991 || isNaN(data2)){
const err13 = {instancePath:instancePath+"/expiresAt",schemaPath:"#/properties/expiresAt/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data2 < 1 || isNaN(data2)){
const err14 = {instancePath:instancePath+"/expiresAt",schemaPath:"#/properties/expiresAt/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
var _valid0 = _errs8 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs10 = errors;
if(data2 !== null){
const err15 = {instancePath:instancePath+"/expiresAt",schemaPath:"#/properties/expiresAt/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
var _valid0 = _errs10 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err16 = {instancePath:instancePath+"/expiresAt",schemaPath:"#/properties/expiresAt/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
else {
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
}
}
if(data.accessCode !== undefined){
let data3 = data.accessCode;
const _errs13 = errors;
let valid2 = false;
const _errs14 = errors;
if(typeof data3 === "string"){
if(!pattern105.test(data3)){
const err17 = {instancePath:instancePath+"/accessCode",schemaPath:"#/properties/accessCode/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[a-zA-Z0-9]{4,12}$"},message:"must match pattern \""+"^[a-zA-Z0-9]{4,12}$"+"\""};
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
const err18 = {instancePath:instancePath+"/accessCode",schemaPath:"#/properties/accessCode/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
var _valid1 = _errs14 === errors;
valid2 = valid2 || _valid1;
if(!valid2){
const _errs16 = errors;
if(data3 !== null){
const err19 = {instancePath:instancePath+"/accessCode",schemaPath:"#/properties/accessCode/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
var _valid1 = _errs16 === errors;
valid2 = valid2 || _valid1;
}
if(!valid2){
const err20 = {instancePath:instancePath+"/accessCode",schemaPath:"#/properties/accessCode/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
else {
errors = _errs13;
if(vErrors !== null){
if(_errs13){
vErrors.length = _errs13;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err21 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
validate91.errors = vErrors;
return errors === 0;
}

export const v82 = validate92;
const schema93 = {"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"fileId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"name":{"type":"string","minLength":1,"maxLength":255,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"size":{"type":"integer","minimum":0,"maximum":9007199254740991},"url":{"type":"string","minLength":1,"maxLength":16384,"pattern":"^https?://"},"accessCode":{"anyOf":[{"type":"string","pattern":"^[a-zA-Z0-9]{4,12}$"},{"type":"null"}]},"createdAt":{"type":"integer","minimum":0,"maximum":9007199254740991},"expiresAt":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"revokedAt":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"state":{"enum":["active","expired","revoked","unavailable"]}},"required":["id","fileId","name","size","url","accessCode","createdAt","expiresAt","revokedAt","state"],"additionalProperties":false};
const pattern109 = new RegExp("^https?://", "u");

function validate92(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(data.fileId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fileId"},message:"must have required property '"+"fileId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.name === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.size === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "size"},message:"must have required property '"+"size"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.url === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "url"},message:"must have required property '"+"url"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.accessCode === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "accessCode"},message:"must have required property '"+"accessCode"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.createdAt === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.expiresAt === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expiresAt"},message:"must have required property '"+"expiresAt"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.revokedAt === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revokedAt"},message:"must have required property '"+"revokedAt"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.state === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
for(const key0 in data){
if(!(func8.call(schema93.properties, key0))){
const err10 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err11 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
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
if(!pattern33.test(data0)){
const err13 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err14 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.fileId !== undefined){
let data1 = data.fileId;
if(typeof data1 === "string"){
if(func2(data1) > 128){
const err15 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(func2(data1) < 1){
const err16 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(!pattern33.test(data1)){
const err17 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err18 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.name !== undefined){
let data2 = data.name;
if(typeof data2 === "string"){
if(func2(data2) > 255){
const err19 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 255},message:"must NOT have more than 255 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(func2(data2) < 1){
const err20 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!pattern33.test(data2)){
const err21 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err22 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.size !== undefined){
let data3 = data.size;
if(!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))){
const err23 = {instancePath:instancePath+"/size",schemaPath:"#/properties/size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(typeof data3 == "number"){
if(data3 > 9007199254740991 || isNaN(data3)){
const err24 = {instancePath:instancePath+"/size",schemaPath:"#/properties/size/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data3 < 0 || isNaN(data3)){
const err25 = {instancePath:instancePath+"/size",schemaPath:"#/properties/size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.url !== undefined){
let data4 = data.url;
if(typeof data4 === "string"){
if(func2(data4) > 16384){
const err26 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/maxLength",keyword:"maxLength",params:{limit: 16384},message:"must NOT have more than 16384 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(func2(data4) < 1){
const err27 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(!pattern109.test(data4)){
const err28 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/pattern",keyword:"pattern",params:{pattern: "^https?://"},message:"must match pattern \""+"^https?://"+"\""};
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
const err29 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.accessCode !== undefined){
let data5 = data.accessCode;
const _errs13 = errors;
let valid1 = false;
const _errs14 = errors;
if(typeof data5 === "string"){
if(!pattern105.test(data5)){
const err30 = {instancePath:instancePath+"/accessCode",schemaPath:"#/properties/accessCode/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[a-zA-Z0-9]{4,12}$"},message:"must match pattern \""+"^[a-zA-Z0-9]{4,12}$"+"\""};
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
const err31 = {instancePath:instancePath+"/accessCode",schemaPath:"#/properties/accessCode/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
var _valid0 = _errs14 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs16 = errors;
if(data5 !== null){
const err32 = {instancePath:instancePath+"/accessCode",schemaPath:"#/properties/accessCode/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
var _valid0 = _errs16 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err33 = {instancePath:instancePath+"/accessCode",schemaPath:"#/properties/accessCode/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
else {
errors = _errs13;
if(vErrors !== null){
if(_errs13){
vErrors.length = _errs13;
}
else {
vErrors = null;
}
}
}
}
if(data.createdAt !== undefined){
let data6 = data.createdAt;
if(!((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6)))){
const err34 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(typeof data6 == "number"){
if(data6 > 9007199254740991 || isNaN(data6)){
const err35 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err36 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.expiresAt !== undefined){
let data7 = data.expiresAt;
const _errs21 = errors;
let valid2 = false;
const _errs22 = errors;
if(!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))){
const err37 = {instancePath:instancePath+"/expiresAt",schemaPath:"#/properties/expiresAt/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(typeof data7 == "number"){
if(data7 > 9007199254740991 || isNaN(data7)){
const err38 = {instancePath:instancePath+"/expiresAt",schemaPath:"#/properties/expiresAt/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(data7 < 0 || isNaN(data7)){
const err39 = {instancePath:instancePath+"/expiresAt",schemaPath:"#/properties/expiresAt/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
var _valid1 = _errs22 === errors;
valid2 = valid2 || _valid1;
if(!valid2){
const _errs24 = errors;
if(data7 !== null){
const err40 = {instancePath:instancePath+"/expiresAt",schemaPath:"#/properties/expiresAt/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
var _valid1 = _errs24 === errors;
valid2 = valid2 || _valid1;
}
if(!valid2){
const err41 = {instancePath:instancePath+"/expiresAt",schemaPath:"#/properties/expiresAt/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
else {
errors = _errs21;
if(vErrors !== null){
if(_errs21){
vErrors.length = _errs21;
}
else {
vErrors = null;
}
}
}
}
if(data.revokedAt !== undefined){
let data8 = data.revokedAt;
const _errs27 = errors;
let valid3 = false;
const _errs28 = errors;
if(!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))){
const err42 = {instancePath:instancePath+"/revokedAt",schemaPath:"#/properties/revokedAt/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(typeof data8 == "number"){
if(data8 > 9007199254740991 || isNaN(data8)){
const err43 = {instancePath:instancePath+"/revokedAt",schemaPath:"#/properties/revokedAt/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if(data8 < 0 || isNaN(data8)){
const err44 = {instancePath:instancePath+"/revokedAt",schemaPath:"#/properties/revokedAt/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
var _valid2 = _errs28 === errors;
valid3 = valid3 || _valid2;
if(!valid3){
const _errs30 = errors;
if(data8 !== null){
const err45 = {instancePath:instancePath+"/revokedAt",schemaPath:"#/properties/revokedAt/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
var _valid2 = _errs30 === errors;
valid3 = valid3 || _valid2;
}
if(!valid3){
const err46 = {instancePath:instancePath+"/revokedAt",schemaPath:"#/properties/revokedAt/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
else {
errors = _errs27;
if(vErrors !== null){
if(_errs27){
vErrors.length = _errs27;
}
else {
vErrors = null;
}
}
}
}
if(data.state !== undefined){
let data9 = data.state;
if(!((((data9 === "active") || (data9 === "expired")) || (data9 === "revoked")) || (data9 === "unavailable"))){
const err47 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/enum",keyword:"enum",params:{allowedValues: schema93.properties.state.enum},message:"must be equal to one of the allowed values"};
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
else {
const err48 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
validate92.errors = vErrors;
return errors === 0;
}

export const v83 = validate93;
const schema94 = {"type":"object","properties":{"fileId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"cursor":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"limit":{"type":"integer","minimum":1,"maximum":200}},"required":[],"additionalProperties":false};

function validate93(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!(((key0 === "fileId") || (key0 === "cursor")) || (key0 === "limit"))){
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
if(data.fileId !== undefined){
let data0 = data.fileId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err1 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(func2(data0) < 1){
const err2 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(!pattern33.test(data0)){
const err3 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err4 = {instancePath:instancePath+"/fileId",schemaPath:"#/properties/fileId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.cursor !== undefined){
let data1 = data.cursor;
if(typeof data1 === "string"){
if(func2(data1) > 128){
const err5 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func2(data1) < 1){
const err6 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern33.test(data1)){
const err7 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.limit !== undefined){
let data2 = data.limit;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err9 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 200 || isNaN(data2)){
const err10 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 200},message:"must be <= 200"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data2 < 1 || isNaN(data2)){
const err11 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
validate93.errors = vErrors;
return errors === 0;
}

export const v84 = validate94;
const schema95 = {"type":"object","properties":{"shares":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"fileId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"name":{"type":"string","minLength":1,"maxLength":255,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"size":{"type":"integer","minimum":0,"maximum":9007199254740991},"url":{"type":"string","minLength":1,"maxLength":16384,"pattern":"^https?://"},"accessCode":{"anyOf":[{"type":"string","pattern":"^[a-zA-Z0-9]{4,12}$"},{"type":"null"}]},"createdAt":{"type":"integer","minimum":0,"maximum":9007199254740991},"expiresAt":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"revokedAt":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"state":{"enum":["active","expired","revoked","unavailable"]}},"required":["id","fileId","name","size","url","accessCode","createdAt","expiresAt","revokedAt","state"],"additionalProperties":false},"maxItems":200},"nextCursor":{"anyOf":[{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]}},"required":["shares","nextCursor"],"additionalProperties":false};

function validate94(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.shares === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "shares"},message:"must have required property '"+"shares"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.nextCursor === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "nextCursor"},message:"must have required property '"+"nextCursor"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "shares") || (key0 === "nextCursor"))){
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
if(data.shares !== undefined){
let data0 = data.shares;
if(Array.isArray(data0)){
if(data0.length > 200){
const err3 = {instancePath:instancePath+"/shares",schemaPath:"#/properties/shares/maxItems",keyword:"maxItems",params:{limit: 200},message:"must NOT have more than 200 items"};
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
if(data1.id === undefined){
const err4 = {instancePath:instancePath+"/shares/" + i0,schemaPath:"#/properties/shares/items/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.fileId === undefined){
const err5 = {instancePath:instancePath+"/shares/" + i0,schemaPath:"#/properties/shares/items/required",keyword:"required",params:{missingProperty: "fileId"},message:"must have required property '"+"fileId"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.name === undefined){
const err6 = {instancePath:instancePath+"/shares/" + i0,schemaPath:"#/properties/shares/items/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.size === undefined){
const err7 = {instancePath:instancePath+"/shares/" + i0,schemaPath:"#/properties/shares/items/required",keyword:"required",params:{missingProperty: "size"},message:"must have required property '"+"size"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.url === undefined){
const err8 = {instancePath:instancePath+"/shares/" + i0,schemaPath:"#/properties/shares/items/required",keyword:"required",params:{missingProperty: "url"},message:"must have required property '"+"url"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1.accessCode === undefined){
const err9 = {instancePath:instancePath+"/shares/" + i0,schemaPath:"#/properties/shares/items/required",keyword:"required",params:{missingProperty: "accessCode"},message:"must have required property '"+"accessCode"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data1.createdAt === undefined){
const err10 = {instancePath:instancePath+"/shares/" + i0,schemaPath:"#/properties/shares/items/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data1.expiresAt === undefined){
const err11 = {instancePath:instancePath+"/shares/" + i0,schemaPath:"#/properties/shares/items/required",keyword:"required",params:{missingProperty: "expiresAt"},message:"must have required property '"+"expiresAt"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data1.revokedAt === undefined){
const err12 = {instancePath:instancePath+"/shares/" + i0,schemaPath:"#/properties/shares/items/required",keyword:"required",params:{missingProperty: "revokedAt"},message:"must have required property '"+"revokedAt"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data1.state === undefined){
const err13 = {instancePath:instancePath+"/shares/" + i0,schemaPath:"#/properties/shares/items/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
for(const key1 in data1){
if(!(func8.call(schema95.properties.shares.items.properties, key1))){
const err14 = {instancePath:instancePath+"/shares/" + i0,schemaPath:"#/properties/shares/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
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
if(func2(data2) > 128){
const err15 = {instancePath:instancePath+"/shares/" + i0+"/id",schemaPath:"#/properties/shares/items/properties/id/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(func2(data2) < 1){
const err16 = {instancePath:instancePath+"/shares/" + i0+"/id",schemaPath:"#/properties/shares/items/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(!pattern33.test(data2)){
const err17 = {instancePath:instancePath+"/shares/" + i0+"/id",schemaPath:"#/properties/shares/items/properties/id/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err18 = {instancePath:instancePath+"/shares/" + i0+"/id",schemaPath:"#/properties/shares/items/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data1.fileId !== undefined){
let data3 = data1.fileId;
if(typeof data3 === "string"){
if(func2(data3) > 128){
const err19 = {instancePath:instancePath+"/shares/" + i0+"/fileId",schemaPath:"#/properties/shares/items/properties/fileId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(func2(data3) < 1){
const err20 = {instancePath:instancePath+"/shares/" + i0+"/fileId",schemaPath:"#/properties/shares/items/properties/fileId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!pattern33.test(data3)){
const err21 = {instancePath:instancePath+"/shares/" + i0+"/fileId",schemaPath:"#/properties/shares/items/properties/fileId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err22 = {instancePath:instancePath+"/shares/" + i0+"/fileId",schemaPath:"#/properties/shares/items/properties/fileId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data1.name !== undefined){
let data4 = data1.name;
if(typeof data4 === "string"){
if(func2(data4) > 255){
const err23 = {instancePath:instancePath+"/shares/" + i0+"/name",schemaPath:"#/properties/shares/items/properties/name/maxLength",keyword:"maxLength",params:{limit: 255},message:"must NOT have more than 255 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(func2(data4) < 1){
const err24 = {instancePath:instancePath+"/shares/" + i0+"/name",schemaPath:"#/properties/shares/items/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(!pattern33.test(data4)){
const err25 = {instancePath:instancePath+"/shares/" + i0+"/name",schemaPath:"#/properties/shares/items/properties/name/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err26 = {instancePath:instancePath+"/shares/" + i0+"/name",schemaPath:"#/properties/shares/items/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data1.size !== undefined){
let data5 = data1.size;
if(!((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5)))){
const err27 = {instancePath:instancePath+"/shares/" + i0+"/size",schemaPath:"#/properties/shares/items/properties/size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(typeof data5 == "number"){
if(data5 > 9007199254740991 || isNaN(data5)){
const err28 = {instancePath:instancePath+"/shares/" + i0+"/size",schemaPath:"#/properties/shares/items/properties/size/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(data5 < 0 || isNaN(data5)){
const err29 = {instancePath:instancePath+"/shares/" + i0+"/size",schemaPath:"#/properties/shares/items/properties/size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data1.url !== undefined){
let data6 = data1.url;
if(typeof data6 === "string"){
if(func2(data6) > 16384){
const err30 = {instancePath:instancePath+"/shares/" + i0+"/url",schemaPath:"#/properties/shares/items/properties/url/maxLength",keyword:"maxLength",params:{limit: 16384},message:"must NOT have more than 16384 characters"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(func2(data6) < 1){
const err31 = {instancePath:instancePath+"/shares/" + i0+"/url",schemaPath:"#/properties/shares/items/properties/url/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(!pattern109.test(data6)){
const err32 = {instancePath:instancePath+"/shares/" + i0+"/url",schemaPath:"#/properties/shares/items/properties/url/pattern",keyword:"pattern",params:{pattern: "^https?://"},message:"must match pattern \""+"^https?://"+"\""};
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
const err33 = {instancePath:instancePath+"/shares/" + i0+"/url",schemaPath:"#/properties/shares/items/properties/url/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data1.accessCode !== undefined){
let data7 = data1.accessCode;
const _errs18 = errors;
let valid4 = false;
const _errs19 = errors;
if(typeof data7 === "string"){
if(!pattern105.test(data7)){
const err34 = {instancePath:instancePath+"/shares/" + i0+"/accessCode",schemaPath:"#/properties/shares/items/properties/accessCode/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[a-zA-Z0-9]{4,12}$"},message:"must match pattern \""+"^[a-zA-Z0-9]{4,12}$"+"\""};
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
const err35 = {instancePath:instancePath+"/shares/" + i0+"/accessCode",schemaPath:"#/properties/shares/items/properties/accessCode/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
var _valid0 = _errs19 === errors;
valid4 = valid4 || _valid0;
if(!valid4){
const _errs21 = errors;
if(data7 !== null){
const err36 = {instancePath:instancePath+"/shares/" + i0+"/accessCode",schemaPath:"#/properties/shares/items/properties/accessCode/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
var _valid0 = _errs21 === errors;
valid4 = valid4 || _valid0;
}
if(!valid4){
const err37 = {instancePath:instancePath+"/shares/" + i0+"/accessCode",schemaPath:"#/properties/shares/items/properties/accessCode/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
else {
errors = _errs18;
if(vErrors !== null){
if(_errs18){
vErrors.length = _errs18;
}
else {
vErrors = null;
}
}
}
}
if(data1.createdAt !== undefined){
let data8 = data1.createdAt;
if(!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))){
const err38 = {instancePath:instancePath+"/shares/" + i0+"/createdAt",schemaPath:"#/properties/shares/items/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(typeof data8 == "number"){
if(data8 > 9007199254740991 || isNaN(data8)){
const err39 = {instancePath:instancePath+"/shares/" + i0+"/createdAt",schemaPath:"#/properties/shares/items/properties/createdAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(data8 < 0 || isNaN(data8)){
const err40 = {instancePath:instancePath+"/shares/" + i0+"/createdAt",schemaPath:"#/properties/shares/items/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data1.expiresAt !== undefined){
let data9 = data1.expiresAt;
const _errs26 = errors;
let valid5 = false;
const _errs27 = errors;
if(!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))){
const err41 = {instancePath:instancePath+"/shares/" + i0+"/expiresAt",schemaPath:"#/properties/shares/items/properties/expiresAt/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
if(typeof data9 == "number"){
if(data9 > 9007199254740991 || isNaN(data9)){
const err42 = {instancePath:instancePath+"/shares/" + i0+"/expiresAt",schemaPath:"#/properties/shares/items/properties/expiresAt/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(data9 < 0 || isNaN(data9)){
const err43 = {instancePath:instancePath+"/shares/" + i0+"/expiresAt",schemaPath:"#/properties/shares/items/properties/expiresAt/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
var _valid1 = _errs27 === errors;
valid5 = valid5 || _valid1;
if(!valid5){
const _errs29 = errors;
if(data9 !== null){
const err44 = {instancePath:instancePath+"/shares/" + i0+"/expiresAt",schemaPath:"#/properties/shares/items/properties/expiresAt/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
var _valid1 = _errs29 === errors;
valid5 = valid5 || _valid1;
}
if(!valid5){
const err45 = {instancePath:instancePath+"/shares/" + i0+"/expiresAt",schemaPath:"#/properties/shares/items/properties/expiresAt/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
else {
errors = _errs26;
if(vErrors !== null){
if(_errs26){
vErrors.length = _errs26;
}
else {
vErrors = null;
}
}
}
}
if(data1.revokedAt !== undefined){
let data10 = data1.revokedAt;
const _errs32 = errors;
let valid6 = false;
const _errs33 = errors;
if(!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))){
const err46 = {instancePath:instancePath+"/shares/" + i0+"/revokedAt",schemaPath:"#/properties/shares/items/properties/revokedAt/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if(typeof data10 == "number"){
if(data10 > 9007199254740991 || isNaN(data10)){
const err47 = {instancePath:instancePath+"/shares/" + i0+"/revokedAt",schemaPath:"#/properties/shares/items/properties/revokedAt/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
if(data10 < 0 || isNaN(data10)){
const err48 = {instancePath:instancePath+"/shares/" + i0+"/revokedAt",schemaPath:"#/properties/shares/items/properties/revokedAt/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
var _valid2 = _errs33 === errors;
valid6 = valid6 || _valid2;
if(!valid6){
const _errs35 = errors;
if(data10 !== null){
const err49 = {instancePath:instancePath+"/shares/" + i0+"/revokedAt",schemaPath:"#/properties/shares/items/properties/revokedAt/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
var _valid2 = _errs35 === errors;
valid6 = valid6 || _valid2;
}
if(!valid6){
const err50 = {instancePath:instancePath+"/shares/" + i0+"/revokedAt",schemaPath:"#/properties/shares/items/properties/revokedAt/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
else {
errors = _errs32;
if(vErrors !== null){
if(_errs32){
vErrors.length = _errs32;
}
else {
vErrors = null;
}
}
}
}
if(data1.state !== undefined){
let data11 = data1.state;
if(!((((data11 === "active") || (data11 === "expired")) || (data11 === "revoked")) || (data11 === "unavailable"))){
const err51 = {instancePath:instancePath+"/shares/" + i0+"/state",schemaPath:"#/properties/shares/items/properties/state/enum",keyword:"enum",params:{allowedValues: schema95.properties.shares.items.properties.state.enum},message:"must be equal to one of the allowed values"};
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
else {
const err52 = {instancePath:instancePath+"/shares/" + i0,schemaPath:"#/properties/shares/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
else {
const err53 = {instancePath:instancePath+"/shares",schemaPath:"#/properties/shares/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
if(data.nextCursor !== undefined){
let data12 = data.nextCursor;
const _errs39 = errors;
let valid7 = false;
const _errs40 = errors;
if(typeof data12 === "string"){
if(func2(data12) > 128){
const err54 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
if(func2(data12) < 1){
const err55 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
if(!pattern33.test(data12)){
const err56 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err57 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
var _valid3 = _errs40 === errors;
valid7 = valid7 || _valid3;
if(!valid7){
const _errs42 = errors;
if(data12 !== null){
const err58 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
var _valid3 = _errs42 === errors;
valid7 = valid7 || _valid3;
}
if(!valid7){
const err59 = {instancePath:instancePath+"/nextCursor",schemaPath:"#/properties/nextCursor/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
else {
errors = _errs39;
if(vErrors !== null){
if(_errs39){
vErrors.length = _errs39;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err60 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
validate94.errors = vErrors;
return errors === 0;
}

export const v85 = validate95;
const schema96 = {"type":"object","properties":{"shareId":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["shareId"],"additionalProperties":false};

function validate95(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.shareId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "shareId"},message:"must have required property '"+"shareId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "shareId")){
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
if(data.shareId !== undefined){
let data0 = data.shareId;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/shareId",schemaPath:"#/properties/shareId/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/shareId",schemaPath:"#/properties/shareId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/shareId",schemaPath:"#/properties/shareId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/shareId",schemaPath:"#/properties/shareId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate95.errors = vErrors;
return errors === 0;
}

export const v86 = validate96;
const schema97 = {"type":"object","properties":{"protocols":{"type":"array","items":{"type":"string","minLength":1,"maxLength":100,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"maxItems":100}},"required":[],"additionalProperties":false};

function validate96(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!(key0 === "protocols")){
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
if(data.protocols !== undefined){
let data0 = data.protocols;
if(Array.isArray(data0)){
if(data0.length > 100){
const err1 = {instancePath:instancePath+"/protocols",schemaPath:"#/properties/protocols/maxItems",keyword:"maxItems",params:{limit: 100},message:"must NOT have more than 100 items"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(typeof data1 === "string"){
if(func2(data1) > 100){
const err2 = {instancePath:instancePath+"/protocols/" + i0,schemaPath:"#/properties/protocols/items/maxLength",keyword:"maxLength",params:{limit: 100},message:"must NOT have more than 100 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data1) < 1){
const err3 = {instancePath:instancePath+"/protocols/" + i0,schemaPath:"#/properties/protocols/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data1)){
const err4 = {instancePath:instancePath+"/protocols/" + i0,schemaPath:"#/properties/protocols/items/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/protocols/" + i0,schemaPath:"#/properties/protocols/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err6 = {instancePath:instancePath+"/protocols",schemaPath:"#/properties/protocols/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
else {
const err7 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
validate96.errors = vErrors;
return errors === 0;
}

export const v87 = validate97;
const schema98 = {"type":"object","properties":{"capabilities":{"type":"array","items":{"type":"object","properties":{"protocol":{"type":"string","minLength":1,"maxLength":100,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"method":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"supported":{"type":"boolean"},"allowed":{"type":"boolean"},"available":{"type":"boolean"},"reason":{"anyOf":[{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]},"permission":{"anyOf":[{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]},"limits":{"type":"object","additionalProperties":{"type":"number"}},"surfaces":{"type":"array","items":{"enum":["ui","backend"]},"maxItems":2}},"required":["protocol","method","supported","allowed","available","reason","permission","limits","surfaces"],"additionalProperties":false},"maxItems":1000}},"required":["capabilities"],"additionalProperties":false};

function validate97(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.capabilities === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "capabilities"},message:"must have required property '"+"capabilities"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "capabilities")){
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
if(data.capabilities !== undefined){
let data0 = data.capabilities;
if(Array.isArray(data0)){
if(data0.length > 1000){
const err2 = {instancePath:instancePath+"/capabilities",schemaPath:"#/properties/capabilities/maxItems",keyword:"maxItems",params:{limit: 1000},message:"must NOT have more than 1000 items"};
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
if(data1.protocol === undefined){
const err3 = {instancePath:instancePath+"/capabilities/" + i0,schemaPath:"#/properties/capabilities/items/required",keyword:"required",params:{missingProperty: "protocol"},message:"must have required property '"+"protocol"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data1.method === undefined){
const err4 = {instancePath:instancePath+"/capabilities/" + i0,schemaPath:"#/properties/capabilities/items/required",keyword:"required",params:{missingProperty: "method"},message:"must have required property '"+"method"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.supported === undefined){
const err5 = {instancePath:instancePath+"/capabilities/" + i0,schemaPath:"#/properties/capabilities/items/required",keyword:"required",params:{missingProperty: "supported"},message:"must have required property '"+"supported"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.allowed === undefined){
const err6 = {instancePath:instancePath+"/capabilities/" + i0,schemaPath:"#/properties/capabilities/items/required",keyword:"required",params:{missingProperty: "allowed"},message:"must have required property '"+"allowed"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.available === undefined){
const err7 = {instancePath:instancePath+"/capabilities/" + i0,schemaPath:"#/properties/capabilities/items/required",keyword:"required",params:{missingProperty: "available"},message:"must have required property '"+"available"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.reason === undefined){
const err8 = {instancePath:instancePath+"/capabilities/" + i0,schemaPath:"#/properties/capabilities/items/required",keyword:"required",params:{missingProperty: "reason"},message:"must have required property '"+"reason"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1.permission === undefined){
const err9 = {instancePath:instancePath+"/capabilities/" + i0,schemaPath:"#/properties/capabilities/items/required",keyword:"required",params:{missingProperty: "permission"},message:"must have required property '"+"permission"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data1.limits === undefined){
const err10 = {instancePath:instancePath+"/capabilities/" + i0,schemaPath:"#/properties/capabilities/items/required",keyword:"required",params:{missingProperty: "limits"},message:"must have required property '"+"limits"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data1.surfaces === undefined){
const err11 = {instancePath:instancePath+"/capabilities/" + i0,schemaPath:"#/properties/capabilities/items/required",keyword:"required",params:{missingProperty: "surfaces"},message:"must have required property '"+"surfaces"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
for(const key1 in data1){
if(!(func8.call(schema98.properties.capabilities.items.properties, key1))){
const err12 = {instancePath:instancePath+"/capabilities/" + i0,schemaPath:"#/properties/capabilities/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data1.protocol !== undefined){
let data2 = data1.protocol;
if(typeof data2 === "string"){
if(func2(data2) > 100){
const err13 = {instancePath:instancePath+"/capabilities/" + i0+"/protocol",schemaPath:"#/properties/capabilities/items/properties/protocol/maxLength",keyword:"maxLength",params:{limit: 100},message:"must NOT have more than 100 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func2(data2) < 1){
const err14 = {instancePath:instancePath+"/capabilities/" + i0+"/protocol",schemaPath:"#/properties/capabilities/items/properties/protocol/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(!pattern33.test(data2)){
const err15 = {instancePath:instancePath+"/capabilities/" + i0+"/protocol",schemaPath:"#/properties/capabilities/items/properties/protocol/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err16 = {instancePath:instancePath+"/capabilities/" + i0+"/protocol",schemaPath:"#/properties/capabilities/items/properties/protocol/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data1.method !== undefined){
let data3 = data1.method;
if(typeof data3 === "string"){
if(func2(data3) > 128){
const err17 = {instancePath:instancePath+"/capabilities/" + i0+"/method",schemaPath:"#/properties/capabilities/items/properties/method/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(func2(data3) < 1){
const err18 = {instancePath:instancePath+"/capabilities/" + i0+"/method",schemaPath:"#/properties/capabilities/items/properties/method/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(!pattern33.test(data3)){
const err19 = {instancePath:instancePath+"/capabilities/" + i0+"/method",schemaPath:"#/properties/capabilities/items/properties/method/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err20 = {instancePath:instancePath+"/capabilities/" + i0+"/method",schemaPath:"#/properties/capabilities/items/properties/method/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data1.supported !== undefined){
if(typeof data1.supported !== "boolean"){
const err21 = {instancePath:instancePath+"/capabilities/" + i0+"/supported",schemaPath:"#/properties/capabilities/items/properties/supported/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data1.allowed !== undefined){
if(typeof data1.allowed !== "boolean"){
const err22 = {instancePath:instancePath+"/capabilities/" + i0+"/allowed",schemaPath:"#/properties/capabilities/items/properties/allowed/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data1.available !== undefined){
if(typeof data1.available !== "boolean"){
const err23 = {instancePath:instancePath+"/capabilities/" + i0+"/available",schemaPath:"#/properties/capabilities/items/properties/available/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data1.reason !== undefined){
let data7 = data1.reason;
const _errs18 = errors;
let valid4 = false;
const _errs19 = errors;
if(typeof data7 === "string"){
if(func2(data7) > 4096){
const err24 = {instancePath:instancePath+"/capabilities/" + i0+"/reason",schemaPath:"#/properties/capabilities/items/properties/reason/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(func2(data7) < 1){
const err25 = {instancePath:instancePath+"/capabilities/" + i0+"/reason",schemaPath:"#/properties/capabilities/items/properties/reason/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(!pattern33.test(data7)){
const err26 = {instancePath:instancePath+"/capabilities/" + i0+"/reason",schemaPath:"#/properties/capabilities/items/properties/reason/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err27 = {instancePath:instancePath+"/capabilities/" + i0+"/reason",schemaPath:"#/properties/capabilities/items/properties/reason/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
var _valid0 = _errs19 === errors;
valid4 = valid4 || _valid0;
if(!valid4){
const _errs21 = errors;
if(data7 !== null){
const err28 = {instancePath:instancePath+"/capabilities/" + i0+"/reason",schemaPath:"#/properties/capabilities/items/properties/reason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
var _valid0 = _errs21 === errors;
valid4 = valid4 || _valid0;
}
if(!valid4){
const err29 = {instancePath:instancePath+"/capabilities/" + i0+"/reason",schemaPath:"#/properties/capabilities/items/properties/reason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
else {
errors = _errs18;
if(vErrors !== null){
if(_errs18){
vErrors.length = _errs18;
}
else {
vErrors = null;
}
}
}
}
if(data1.permission !== undefined){
let data8 = data1.permission;
const _errs24 = errors;
let valid5 = false;
const _errs25 = errors;
if(typeof data8 === "string"){
if(func2(data8) > 4096){
const err30 = {instancePath:instancePath+"/capabilities/" + i0+"/permission",schemaPath:"#/properties/capabilities/items/properties/permission/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(func2(data8) < 1){
const err31 = {instancePath:instancePath+"/capabilities/" + i0+"/permission",schemaPath:"#/properties/capabilities/items/properties/permission/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(!pattern33.test(data8)){
const err32 = {instancePath:instancePath+"/capabilities/" + i0+"/permission",schemaPath:"#/properties/capabilities/items/properties/permission/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err33 = {instancePath:instancePath+"/capabilities/" + i0+"/permission",schemaPath:"#/properties/capabilities/items/properties/permission/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
var _valid1 = _errs25 === errors;
valid5 = valid5 || _valid1;
if(!valid5){
const _errs27 = errors;
if(data8 !== null){
const err34 = {instancePath:instancePath+"/capabilities/" + i0+"/permission",schemaPath:"#/properties/capabilities/items/properties/permission/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
var _valid1 = _errs27 === errors;
valid5 = valid5 || _valid1;
}
if(!valid5){
const err35 = {instancePath:instancePath+"/capabilities/" + i0+"/permission",schemaPath:"#/properties/capabilities/items/properties/permission/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
else {
errors = _errs24;
if(vErrors !== null){
if(_errs24){
vErrors.length = _errs24;
}
else {
vErrors = null;
}
}
}
}
if(data1.limits !== undefined){
let data9 = data1.limits;
if(data9 && typeof data9 == "object" && !Array.isArray(data9)){
for(const key2 in data9){
if(!(typeof data9[key2] == "number")){
const err36 = {instancePath:instancePath+"/capabilities/" + i0+"/limits/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/capabilities/items/properties/limits/additionalProperties/type",keyword:"type",params:{type: "number"},message:"must be number"};
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
const err37 = {instancePath:instancePath+"/capabilities/" + i0+"/limits",schemaPath:"#/properties/capabilities/items/properties/limits/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data1.surfaces !== undefined){
let data11 = data1.surfaces;
if(Array.isArray(data11)){
if(data11.length > 2){
const err38 = {instancePath:instancePath+"/capabilities/" + i0+"/surfaces",schemaPath:"#/properties/capabilities/items/properties/surfaces/maxItems",keyword:"maxItems",params:{limit: 2},message:"must NOT have more than 2 items"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
const len1 = data11.length;
for(let i1=0; i1<len1; i1++){
let data12 = data11[i1];
if(!((data12 === "ui") || (data12 === "backend"))){
const err39 = {instancePath:instancePath+"/capabilities/" + i0+"/surfaces/" + i1,schemaPath:"#/properties/capabilities/items/properties/surfaces/items/enum",keyword:"enum",params:{allowedValues: schema98.properties.capabilities.items.properties.surfaces.items.enum},message:"must be equal to one of the allowed values"};
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
const err40 = {instancePath:instancePath+"/capabilities/" + i0+"/surfaces",schemaPath:"#/properties/capabilities/items/properties/surfaces/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
const err41 = {instancePath:instancePath+"/capabilities/" + i0,schemaPath:"#/properties/capabilities/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err42 = {instancePath:instancePath+"/capabilities",schemaPath:"#/properties/capabilities/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
else {
const err43 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
validate97.errors = vErrors;
return errors === 0;
}

export const v88 = validate98;
const schema99 = {"type":"object","properties":{},"required":[],"additionalProperties":false};

function validate98(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate98.errors = vErrors;
return errors === 0;
}

export const v89 = validate99;
const schema100 = {"type":"object","properties":{"hostApiVersion":{"type":"string","minLength":1,"maxLength":100,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"sdkVersion":{"type":"string","minLength":1,"maxLength":100,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"manifestSchemaVersion":{"type":"integer","minimum":0,"maximum":9007199254740991},"contractHash":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"sdkHash":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["hostApiVersion","sdkVersion","manifestSchemaVersion","contractHash","sdkHash"],"additionalProperties":false};

function validate99(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.hostApiVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "hostApiVersion"},message:"must have required property '"+"hostApiVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.sdkVersion === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sdkVersion"},message:"must have required property '"+"sdkVersion"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.manifestSchemaVersion === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "manifestSchemaVersion"},message:"must have required property '"+"manifestSchemaVersion"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.contractHash === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contractHash"},message:"must have required property '"+"contractHash"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.sdkHash === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sdkHash"},message:"must have required property '"+"sdkHash"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "hostApiVersion") || (key0 === "sdkVersion")) || (key0 === "manifestSchemaVersion")) || (key0 === "contractHash")) || (key0 === "sdkHash"))){
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
if(data.hostApiVersion !== undefined){
let data0 = data.hostApiVersion;
if(typeof data0 === "string"){
if(func2(data0) > 100){
const err6 = {instancePath:instancePath+"/hostApiVersion",schemaPath:"#/properties/hostApiVersion/maxLength",keyword:"maxLength",params:{limit: 100},message:"must NOT have more than 100 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func2(data0) < 1){
const err7 = {instancePath:instancePath+"/hostApiVersion",schemaPath:"#/properties/hostApiVersion/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern33.test(data0)){
const err8 = {instancePath:instancePath+"/hostApiVersion",schemaPath:"#/properties/hostApiVersion/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err9 = {instancePath:instancePath+"/hostApiVersion",schemaPath:"#/properties/hostApiVersion/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.sdkVersion !== undefined){
let data1 = data.sdkVersion;
if(typeof data1 === "string"){
if(func2(data1) > 100){
const err10 = {instancePath:instancePath+"/sdkVersion",schemaPath:"#/properties/sdkVersion/maxLength",keyword:"maxLength",params:{limit: 100},message:"must NOT have more than 100 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func2(data1) < 1){
const err11 = {instancePath:instancePath+"/sdkVersion",schemaPath:"#/properties/sdkVersion/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!pattern33.test(data1)){
const err12 = {instancePath:instancePath+"/sdkVersion",schemaPath:"#/properties/sdkVersion/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err13 = {instancePath:instancePath+"/sdkVersion",schemaPath:"#/properties/sdkVersion/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.manifestSchemaVersion !== undefined){
let data2 = data.manifestSchemaVersion;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err14 = {instancePath:instancePath+"/manifestSchemaVersion",schemaPath:"#/properties/manifestSchemaVersion/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 9007199254740991 || isNaN(data2)){
const err15 = {instancePath:instancePath+"/manifestSchemaVersion",schemaPath:"#/properties/manifestSchemaVersion/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err16 = {instancePath:instancePath+"/manifestSchemaVersion",schemaPath:"#/properties/manifestSchemaVersion/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.contractHash !== undefined){
let data3 = data.contractHash;
if(typeof data3 === "string"){
if(func2(data3) > 64){
const err17 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(func2(data3) < 1){
const err18 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(!pattern33.test(data3)){
const err19 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err20 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.sdkHash !== undefined){
let data4 = data.sdkHash;
if(typeof data4 === "string"){
if(func2(data4) > 64){
const err21 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(func2(data4) < 1){
const err22 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(!pattern33.test(data4)){
const err23 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err24 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err25 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
validate99.errors = vErrors;
return errors === 0;
}

export const v90 = validate100;
const schema101 = {"type":"object","properties":{"kind":{"type":"string","minLength":1,"maxLength":32,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"offset":{"type":"integer","minimum":0,"maximum":9007199254740991},"limit":{"type":"integer","minimum":1,"maximum":100}},"required":[],"additionalProperties":false};

function validate100(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!(((key0 === "kind") || (key0 === "offset")) || (key0 === "limit"))){
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
if(data.kind !== undefined){
let data0 = data.kind;
if(typeof data0 === "string"){
if(func2(data0) > 32){
const err1 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(func2(data0) < 1){
const err2 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(!pattern33.test(data0)){
const err3 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err4 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.offset !== undefined){
let data1 = data.offset;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err5 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 > 9007199254740991 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
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
if(data2 > 100 || isNaN(data2)){
const err9 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 100},message:"must be <= 100"};
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
validate100.errors = vErrors;
return errors === 0;
}

export const v91 = validate101;
const schema102 = {"type":"object","properties":{"contractHash":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"items":{"type":"array","items":{"type":"object","properties":{"kind":{"type":"string","minLength":1,"maxLength":32,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"member":{"type":"string","minLength":1,"maxLength":256,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["kind","member"],"additionalProperties":false},"maxItems":100},"nextOffset":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]}},"required":["contractHash","items","nextOffset"],"additionalProperties":false};

function validate101(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.contractHash === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contractHash"},message:"must have required property '"+"contractHash"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.items === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "items"},message:"must have required property '"+"items"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.nextOffset === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "nextOffset"},message:"must have required property '"+"nextOffset"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "contractHash") || (key0 === "items")) || (key0 === "nextOffset"))){
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
if(data.contractHash !== undefined){
let data0 = data.contractHash;
if(typeof data0 === "string"){
if(func2(data0) > 64){
const err4 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func2(data0) < 1){
const err5 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern33.test(data0)){
const err6 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err7 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.items !== undefined){
let data1 = data.items;
if(Array.isArray(data1)){
if(data1.length > 100){
const err8 = {instancePath:instancePath+"/items",schemaPath:"#/properties/items/maxItems",keyword:"maxItems",params:{limit: 100},message:"must NOT have more than 100 items"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
const len0 = data1.length;
for(let i0=0; i0<len0; i0++){
let data2 = data1[i0];
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.kind === undefined){
const err9 = {instancePath:instancePath+"/items/" + i0,schemaPath:"#/properties/items/items/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data2.member === undefined){
const err10 = {instancePath:instancePath+"/items/" + i0,schemaPath:"#/properties/items/items/required",keyword:"required",params:{missingProperty: "member"},message:"must have required property '"+"member"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
for(const key1 in data2){
if(!((key1 === "kind") || (key1 === "member"))){
const err11 = {instancePath:instancePath+"/items/" + i0,schemaPath:"#/properties/items/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data2.kind !== undefined){
let data3 = data2.kind;
if(typeof data3 === "string"){
if(func2(data3) > 32){
const err12 = {instancePath:instancePath+"/items/" + i0+"/kind",schemaPath:"#/properties/items/items/properties/kind/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func2(data3) < 1){
const err13 = {instancePath:instancePath+"/items/" + i0+"/kind",schemaPath:"#/properties/items/items/properties/kind/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern33.test(data3)){
const err14 = {instancePath:instancePath+"/items/" + i0+"/kind",schemaPath:"#/properties/items/items/properties/kind/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err15 = {instancePath:instancePath+"/items/" + i0+"/kind",schemaPath:"#/properties/items/items/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data2.member !== undefined){
let data4 = data2.member;
if(typeof data4 === "string"){
if(func2(data4) > 256){
const err16 = {instancePath:instancePath+"/items/" + i0+"/member",schemaPath:"#/properties/items/items/properties/member/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func2(data4) < 1){
const err17 = {instancePath:instancePath+"/items/" + i0+"/member",schemaPath:"#/properties/items/items/properties/member/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern33.test(data4)){
const err18 = {instancePath:instancePath+"/items/" + i0+"/member",schemaPath:"#/properties/items/items/properties/member/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err19 = {instancePath:instancePath+"/items/" + i0+"/member",schemaPath:"#/properties/items/items/properties/member/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err20 = {instancePath:instancePath+"/items/" + i0,schemaPath:"#/properties/items/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
else {
const err21 = {instancePath:instancePath+"/items",schemaPath:"#/properties/items/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.nextOffset !== undefined){
let data5 = data.nextOffset;
const _errs14 = errors;
let valid4 = false;
const _errs15 = errors;
if(!((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5)))){
const err22 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(typeof data5 == "number"){
if(data5 > 9007199254740991 || isNaN(data5)){
const err23 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data5 < 0 || isNaN(data5)){
const err24 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
var _valid0 = _errs15 === errors;
valid4 = valid4 || _valid0;
if(!valid4){
const _errs17 = errors;
if(data5 !== null){
const err25 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
var _valid0 = _errs17 === errors;
valid4 = valid4 || _valid0;
}
if(!valid4){
const err26 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
else {
errors = _errs14;
if(vErrors !== null){
if(_errs14){
vErrors.length = _errs14;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err27 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
validate101.errors = vErrors;
return errors === 0;
}

export const v92 = validate102;
const schema103 = {"type":"object","properties":{"kind":{"type":"string","minLength":1,"maxLength":32,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"member":{"type":"string","minLength":1,"maxLength":256,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"contractHash":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["kind","member","contractHash"],"additionalProperties":false};

function validate102(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.member === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "member"},message:"must have required property '"+"member"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contractHash === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contractHash"},message:"must have required property '"+"contractHash"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "kind") || (key0 === "member")) || (key0 === "contractHash"))){
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
if(data.kind !== undefined){
let data0 = data.kind;
if(typeof data0 === "string"){
if(func2(data0) > 32){
const err4 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func2(data0) < 1){
const err5 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern33.test(data0)){
const err6 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err7 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.member !== undefined){
let data1 = data.member;
if(typeof data1 === "string"){
if(func2(data1) > 256){
const err8 = {instancePath:instancePath+"/member",schemaPath:"#/properties/member/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func2(data1) < 1){
const err9 = {instancePath:instancePath+"/member",schemaPath:"#/properties/member/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern33.test(data1)){
const err10 = {instancePath:instancePath+"/member",schemaPath:"#/properties/member/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err11 = {instancePath:instancePath+"/member",schemaPath:"#/properties/member/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.contractHash !== undefined){
let data2 = data.contractHash;
if(typeof data2 === "string"){
if(func2(data2) > 64){
const err12 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func2(data2) < 1){
const err13 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern33.test(data2)){
const err14 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err15 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate102.errors = vErrors;
return errors === 0;
}

export const v93 = validate103;
const schema104 = {"type":"object","properties":{"kind":{"type":"string","minLength":1,"maxLength":32,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"member":{"type":"string","minLength":1,"maxLength":256,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"contractHash":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"document":{"type":"object","additionalProperties":true}},"required":["kind","member","contractHash","document"],"additionalProperties":false};

function validate103(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.member === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "member"},message:"must have required property '"+"member"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contractHash === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contractHash"},message:"must have required property '"+"contractHash"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.document === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "document"},message:"must have required property '"+"document"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "kind") || (key0 === "member")) || (key0 === "contractHash")) || (key0 === "document"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.kind !== undefined){
let data0 = data.kind;
if(typeof data0 === "string"){
if(func2(data0) > 32){
const err5 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func2(data0) < 1){
const err6 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern33.test(data0)){
const err7 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.member !== undefined){
let data1 = data.member;
if(typeof data1 === "string"){
if(func2(data1) > 256){
const err9 = {instancePath:instancePath+"/member",schemaPath:"#/properties/member/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func2(data1) < 1){
const err10 = {instancePath:instancePath+"/member",schemaPath:"#/properties/member/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(!pattern33.test(data1)){
const err11 = {instancePath:instancePath+"/member",schemaPath:"#/properties/member/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err12 = {instancePath:instancePath+"/member",schemaPath:"#/properties/member/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.contractHash !== undefined){
let data2 = data.contractHash;
if(typeof data2 === "string"){
if(func2(data2) > 64){
const err13 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func2(data2) < 1){
const err14 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(!pattern33.test(data2)){
const err15 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err16 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.document !== undefined){
let data3 = data.document;
if(data3 && typeof data3 == "object" && !Array.isArray(data3)){
}
else {
const err17 = {instancePath:instancePath+"/document",schemaPath:"#/properties/document/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
else {
const err18 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
validate103.errors = vErrors;
return errors === 0;
}

export const v94 = validate104;
const schema105 = {"type":"object","properties":{"projectRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"sdkHash":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["projectRef","sdkHash"],"additionalProperties":false};

function validate104(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.projectRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "projectRef"},message:"must have required property '"+"projectRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.sdkHash === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sdkHash"},message:"must have required property '"+"sdkHash"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "projectRef") || (key0 === "sdkHash"))){
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
if(data.projectRef !== undefined){
let data0 = data.projectRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err3 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern33.test(data0)){
const err5 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err6 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.sdkHash !== undefined){
let data1 = data.sdkHash;
if(typeof data1 === "string"){
if(func2(data1) > 64){
const err7 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data1) < 1){
const err8 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern33.test(data1)){
const err9 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err10 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate104.errors = vErrors;
return errors === 0;
}

export const v95 = validate105;
const schema106 = {"type":"object","properties":{"projectRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"path":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"sdkHash":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"contractHash":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["projectRef","path","sdkHash","contractHash"],"additionalProperties":false};

function validate105(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.projectRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "projectRef"},message:"must have required property '"+"projectRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.path === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.sdkHash === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sdkHash"},message:"must have required property '"+"sdkHash"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.contractHash === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contractHash"},message:"must have required property '"+"contractHash"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "projectRef") || (key0 === "path")) || (key0 === "sdkHash")) || (key0 === "contractHash"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.projectRef !== undefined){
let data0 = data.projectRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err5 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func2(data0) < 1){
const err6 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern33.test(data0)){
const err7 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.path !== undefined){
let data1 = data.path;
if(typeof data1 === "string"){
if(func2(data1) > 4096){
const err9 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func2(data1) < 1){
const err10 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(!pattern33.test(data1)){
const err11 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err12 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.sdkHash !== undefined){
let data2 = data.sdkHash;
if(typeof data2 === "string"){
if(func2(data2) > 64){
const err13 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func2(data2) < 1){
const err14 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(!pattern33.test(data2)){
const err15 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err16 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.contractHash !== undefined){
let data3 = data.contractHash;
if(typeof data3 === "string"){
if(func2(data3) > 64){
const err17 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(func2(data3) < 1){
const err18 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(!pattern33.test(data3)){
const err19 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err20 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
else {
const err21 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
validate105.errors = vErrors;
return errors === 0;
}

export const v96 = validate106;
const schema107 = {"type":"object","properties":{},"required":[],"additionalProperties":false};

function validate106(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate106.errors = vErrors;
return errors === 0;
}

export const v97 = validate107;
const schema108 = {"type":"object","properties":{"available":{"type":"boolean"},"reason":{"anyOf":[{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]},"provider":{"anyOf":[{"type":"object","additionalProperties":true},{"type":"null"}]}},"required":["available","reason","provider"],"additionalProperties":false};

function validate107(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.available === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "available"},message:"must have required property '"+"available"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.reason === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "reason"},message:"must have required property '"+"reason"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.provider === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "provider"},message:"must have required property '"+"provider"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "available") || (key0 === "reason")) || (key0 === "provider"))){
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
if(data.available !== undefined){
if(typeof data.available !== "boolean"){
const err4 = {instancePath:instancePath+"/available",schemaPath:"#/properties/available/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.reason !== undefined){
let data1 = data.reason;
const _errs5 = errors;
let valid1 = false;
const _errs6 = errors;
if(typeof data1 === "string"){
if(func2(data1) > 4096){
const err5 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func2(data1) < 1){
const err6 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern33.test(data1)){
const err7 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
var _valid0 = _errs6 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs8 = errors;
if(data1 !== null){
const err9 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
var _valid0 = _errs8 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err10 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
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
if(data.provider !== undefined){
let data2 = data.provider;
const _errs11 = errors;
let valid2 = false;
const _errs12 = errors;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
}
else {
const err11 = {instancePath:instancePath+"/provider",schemaPath:"#/properties/provider/anyOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
var _valid1 = _errs12 === errors;
valid2 = valid2 || _valid1;
if(!valid2){
const _errs15 = errors;
if(data2 !== null){
const err12 = {instancePath:instancePath+"/provider",schemaPath:"#/properties/provider/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
var _valid1 = _errs15 === errors;
valid2 = valid2 || _valid1;
}
if(!valid2){
const err13 = {instancePath:instancePath+"/provider",schemaPath:"#/properties/provider/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
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
}
else {
const err14 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
validate107.errors = vErrors;
return errors === 0;
}

export const v98 = validate108;
const schema109 = {"type":"object","properties":{"intent":{"enum":["create","edit"]},"targetRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"ref":{"type":"object","additionalProperties":true},"prompt":{"type":"string","maxLength":4000}},"required":["intent"],"additionalProperties":false};

function validate108(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.intent === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "intent"},message:"must have required property '"+"intent"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "intent") || (key0 === "targetRef")) || (key0 === "ref")) || (key0 === "prompt"))){
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
if(data.intent !== undefined){
let data0 = data.intent;
if(!((data0 === "create") || (data0 === "edit"))){
const err2 = {instancePath:instancePath+"/intent",schemaPath:"#/properties/intent/enum",keyword:"enum",params:{allowedValues: schema109.properties.intent.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.targetRef !== undefined){
let data1 = data.targetRef;
if(typeof data1 === "string"){
if(func2(data1) > 160){
const err3 = {instancePath:instancePath+"/targetRef",schemaPath:"#/properties/targetRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func2(data1) < 1){
const err4 = {instancePath:instancePath+"/targetRef",schemaPath:"#/properties/targetRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern33.test(data1)){
const err5 = {instancePath:instancePath+"/targetRef",schemaPath:"#/properties/targetRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err6 = {instancePath:instancePath+"/targetRef",schemaPath:"#/properties/targetRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.ref !== undefined){
let data2 = data.ref;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
}
else {
const err7 = {instancePath:instancePath+"/ref",schemaPath:"#/properties/ref/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.prompt !== undefined){
let data3 = data.prompt;
if(typeof data3 === "string"){
if(func2(data3) > 4000){
const err8 = {instancePath:instancePath+"/prompt",schemaPath:"#/properties/prompt/maxLength",keyword:"maxLength",params:{limit: 4000},message:"must NOT have more than 4000 characters"};
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
const err9 = {instancePath:instancePath+"/prompt",schemaPath:"#/properties/prompt/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate108.errors = vErrors;
return errors === 0;
}

export const v99 = validate109;
const schema110 = {"type":"object","additionalProperties":true};

function validate109(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
}
else {
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate109.errors = vErrors;
return errors === 0;
}

export const v100 = validate110;
const schema111 = {"type":"object","properties":{"kind":{"enum":["apps","projects"]}},"required":[],"additionalProperties":false};

function validate110(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!(key0 === "kind")){
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
if(data.kind !== undefined){
let data0 = data.kind;
if(!((data0 === "apps") || (data0 === "projects"))){
const err1 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema111.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
}
else {
const err2 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
validate110.errors = vErrors;
return errors === 0;
}

export const v101 = validate111;
const schema112 = {"type":"object","properties":{"items":{"type":"array","items":{"type":"object","additionalProperties":true},"maxItems":1000}},"required":["items"],"additionalProperties":false};

function validate111(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.items === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "items"},message:"must have required property '"+"items"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "items")){
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
if(data.items !== undefined){
let data0 = data.items;
if(Array.isArray(data0)){
if(data0.length > 1000){
const err2 = {instancePath:instancePath+"/items",schemaPath:"#/properties/items/maxItems",keyword:"maxItems",params:{limit: 1000},message:"must NOT have more than 1000 items"};
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
}
else {
const err3 = {instancePath:instancePath+"/items/" + i0,schemaPath:"#/properties/items/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
}
else {
const err4 = {instancePath:instancePath+"/items",schemaPath:"#/properties/items/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate111.errors = vErrors;
return errors === 0;
}

export const v102 = validate112;
const schema113 = {"type":"object","properties":{"projectRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"targetRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"appId":{"type":"string","minLength":1,"maxLength":100,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":[],"additionalProperties":false};

function validate112(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!(((key0 === "projectRef") || (key0 === "targetRef")) || (key0 === "appId"))){
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
if(data.projectRef !== undefined){
let data0 = data.projectRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err1 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(func2(data0) < 1){
const err2 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(!pattern33.test(data0)){
const err3 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err4 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.targetRef !== undefined){
let data1 = data.targetRef;
if(typeof data1 === "string"){
if(func2(data1) > 160){
const err5 = {instancePath:instancePath+"/targetRef",schemaPath:"#/properties/targetRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func2(data1) < 1){
const err6 = {instancePath:instancePath+"/targetRef",schemaPath:"#/properties/targetRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern33.test(data1)){
const err7 = {instancePath:instancePath+"/targetRef",schemaPath:"#/properties/targetRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/targetRef",schemaPath:"#/properties/targetRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.appId !== undefined){
let data2 = data.appId;
if(typeof data2 === "string"){
if(func2(data2) > 100){
const err9 = {instancePath:instancePath+"/appId",schemaPath:"#/properties/appId/maxLength",keyword:"maxLength",params:{limit: 100},message:"must NOT have more than 100 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func2(data2) < 1){
const err10 = {instancePath:instancePath+"/appId",schemaPath:"#/properties/appId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(!pattern33.test(data2)){
const err11 = {instancePath:instancePath+"/appId",schemaPath:"#/properties/appId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err12 = {instancePath:instancePath+"/appId",schemaPath:"#/properties/appId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
else {
const err13 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
validate112.errors = vErrors;
return errors === 0;
}

export const v103 = validate113;
const schema114 = {"type":"object","properties":{"intent":{"enum":["create","edit"]},"projectId":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"projectRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"draftRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"targetRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"appId":{"type":"string","minLength":1,"maxLength":100,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"sourcePath":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"replaceOriginal":{"type":"boolean"}},"required":["intent","projectId"],"additionalProperties":false};

function validate113(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.intent === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "intent"},message:"must have required property '"+"intent"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.projectId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "projectId"},message:"must have required property '"+"projectId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "intent") || (key0 === "projectId")) || (key0 === "projectRef")) || (key0 === "draftRef")) || (key0 === "targetRef")) || (key0 === "appId")) || (key0 === "sourcePath")) || (key0 === "replaceOriginal"))){
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
if(data.intent !== undefined){
let data0 = data.intent;
if(!((data0 === "create") || (data0 === "edit"))){
const err3 = {instancePath:instancePath+"/intent",schemaPath:"#/properties/intent/enum",keyword:"enum",params:{allowedValues: schema114.properties.intent.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.projectId !== undefined){
let data1 = data.projectId;
if(typeof data1 === "string"){
if(func2(data1) > 160){
const err4 = {instancePath:instancePath+"/projectId",schemaPath:"#/properties/projectId/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func2(data1) < 1){
const err5 = {instancePath:instancePath+"/projectId",schemaPath:"#/properties/projectId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern33.test(data1)){
const err6 = {instancePath:instancePath+"/projectId",schemaPath:"#/properties/projectId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err7 = {instancePath:instancePath+"/projectId",schemaPath:"#/properties/projectId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.projectRef !== undefined){
let data2 = data.projectRef;
if(typeof data2 === "string"){
if(func2(data2) > 160){
const err8 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func2(data2) < 1){
const err9 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern33.test(data2)){
const err10 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err11 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.draftRef !== undefined){
let data3 = data.draftRef;
if(typeof data3 === "string"){
if(func2(data3) > 160){
const err12 = {instancePath:instancePath+"/draftRef",schemaPath:"#/properties/draftRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func2(data3) < 1){
const err13 = {instancePath:instancePath+"/draftRef",schemaPath:"#/properties/draftRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern33.test(data3)){
const err14 = {instancePath:instancePath+"/draftRef",schemaPath:"#/properties/draftRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err15 = {instancePath:instancePath+"/draftRef",schemaPath:"#/properties/draftRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.targetRef !== undefined){
let data4 = data.targetRef;
if(typeof data4 === "string"){
if(func2(data4) > 160){
const err16 = {instancePath:instancePath+"/targetRef",schemaPath:"#/properties/targetRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func2(data4) < 1){
const err17 = {instancePath:instancePath+"/targetRef",schemaPath:"#/properties/targetRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern33.test(data4)){
const err18 = {instancePath:instancePath+"/targetRef",schemaPath:"#/properties/targetRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err19 = {instancePath:instancePath+"/targetRef",schemaPath:"#/properties/targetRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.appId !== undefined){
let data5 = data.appId;
if(typeof data5 === "string"){
if(func2(data5) > 100){
const err20 = {instancePath:instancePath+"/appId",schemaPath:"#/properties/appId/maxLength",keyword:"maxLength",params:{limit: 100},message:"must NOT have more than 100 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(func2(data5) < 1){
const err21 = {instancePath:instancePath+"/appId",schemaPath:"#/properties/appId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(!pattern33.test(data5)){
const err22 = {instancePath:instancePath+"/appId",schemaPath:"#/properties/appId/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err23 = {instancePath:instancePath+"/appId",schemaPath:"#/properties/appId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.sourcePath !== undefined){
let data6 = data.sourcePath;
if(typeof data6 === "string"){
if(func2(data6) > 4096){
const err24 = {instancePath:instancePath+"/sourcePath",schemaPath:"#/properties/sourcePath/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(func2(data6) < 1){
const err25 = {instancePath:instancePath+"/sourcePath",schemaPath:"#/properties/sourcePath/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(!pattern33.test(data6)){
const err26 = {instancePath:instancePath+"/sourcePath",schemaPath:"#/properties/sourcePath/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err27 = {instancePath:instancePath+"/sourcePath",schemaPath:"#/properties/sourcePath/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data.replaceOriginal !== undefined){
if(typeof data.replaceOriginal !== "boolean"){
const err28 = {instancePath:instancePath+"/replaceOriginal",schemaPath:"#/properties/replaceOriginal/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
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
validate113.errors = vErrors;
return errors === 0;
}

export const v104 = validate114;
const schema115 = {"type":"object","properties":{"projectRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"submissionKey":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"sourceHash":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"contractHash":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"sdkHash":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"installDependencies":{"type":"boolean"}},"required":["projectRef","submissionKey","sourceHash","contractHash","sdkHash"],"additionalProperties":false};

function validate114(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.projectRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "projectRef"},message:"must have required property '"+"projectRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.submissionKey === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "submissionKey"},message:"must have required property '"+"submissionKey"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.sourceHash === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sourceHash"},message:"must have required property '"+"sourceHash"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.contractHash === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contractHash"},message:"must have required property '"+"contractHash"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.sdkHash === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sdkHash"},message:"must have required property '"+"sdkHash"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "projectRef") || (key0 === "submissionKey")) || (key0 === "sourceHash")) || (key0 === "contractHash")) || (key0 === "sdkHash")) || (key0 === "installDependencies"))){
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
if(data.projectRef !== undefined){
let data0 = data.projectRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err6 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func2(data0) < 1){
const err7 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern33.test(data0)){
const err8 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err9 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.submissionKey !== undefined){
let data1 = data.submissionKey;
if(typeof data1 === "string"){
if(func2(data1) > 160){
const err10 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func2(data1) < 1){
const err11 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!pattern33.test(data1)){
const err12 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err13 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.sourceHash !== undefined){
let data2 = data.sourceHash;
if(typeof data2 === "string"){
if(func2(data2) > 64){
const err14 = {instancePath:instancePath+"/sourceHash",schemaPath:"#/properties/sourceHash/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func2(data2) < 1){
const err15 = {instancePath:instancePath+"/sourceHash",schemaPath:"#/properties/sourceHash/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(!pattern33.test(data2)){
const err16 = {instancePath:instancePath+"/sourceHash",schemaPath:"#/properties/sourceHash/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err17 = {instancePath:instancePath+"/sourceHash",schemaPath:"#/properties/sourceHash/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.contractHash !== undefined){
let data3 = data.contractHash;
if(typeof data3 === "string"){
if(func2(data3) > 64){
const err18 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(func2(data3) < 1){
const err19 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(!pattern33.test(data3)){
const err20 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err21 = {instancePath:instancePath+"/contractHash",schemaPath:"#/properties/contractHash/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.sdkHash !== undefined){
let data4 = data.sdkHash;
if(typeof data4 === "string"){
if(func2(data4) > 64){
const err22 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(func2(data4) < 1){
const err23 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(!pattern33.test(data4)){
const err24 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err25 = {instancePath:instancePath+"/sdkHash",schemaPath:"#/properties/sdkHash/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.installDependencies !== undefined){
if(typeof data.installDependencies !== "boolean"){
const err26 = {instancePath:instancePath+"/installDependencies",schemaPath:"#/properties/installDependencies/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
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
const err27 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
validate114.errors = vErrors;
return errors === 0;
}

export const v105 = validate115;
const schema116 = {"type":"object","properties":{"operationRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"kind":{"type":"string","minLength":1,"maxLength":32,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"status":{"type":"string","minLength":1,"maxLength":32,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"projectRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"createdAt":{"type":"integer","minimum":0,"maximum":9007199254740991},"updatedAt":{"type":"integer","minimum":0,"maximum":9007199254740991},"result":{"type":"object","additionalProperties":true},"error":{"anyOf":[{"type":"string","minLength":1,"maxLength":8192,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]},"log":{"type":"string","maxLength":65536},"nextOffset":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["operationRef","kind","status","projectRef","createdAt","updatedAt"],"additionalProperties":false};

function validate115(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operationRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationRef"},message:"must have required property '"+"operationRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.kind === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
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
if(data.projectRef === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "projectRef"},message:"must have required property '"+"projectRef"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.createdAt === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "createdAt"},message:"must have required property '"+"createdAt"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.updatedAt === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "updatedAt"},message:"must have required property '"+"updatedAt"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!(func8.call(schema116.properties, key0))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.operationRef !== undefined){
let data0 = data.operationRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err7 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data0) < 1){
const err8 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern33.test(data0)){
const err9 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err10 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.kind !== undefined){
let data1 = data.kind;
if(typeof data1 === "string"){
if(func2(data1) > 32){
const err11 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func2(data1) < 1){
const err12 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(!pattern33.test(data1)){
const err13 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err14 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.status !== undefined){
let data2 = data.status;
if(typeof data2 === "string"){
if(func2(data2) > 32){
const err15 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(func2(data2) < 1){
const err16 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(!pattern33.test(data2)){
const err17 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err18 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.projectRef !== undefined){
let data3 = data.projectRef;
if(typeof data3 === "string"){
if(func2(data3) > 160){
const err19 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(func2(data3) < 1){
const err20 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!pattern33.test(data3)){
const err21 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err22 = {instancePath:instancePath+"/projectRef",schemaPath:"#/properties/projectRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.createdAt !== undefined){
let data4 = data.createdAt;
if(!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))){
const err23 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(typeof data4 == "number"){
if(data4 > 9007199254740991 || isNaN(data4)){
const err24 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data4 < 0 || isNaN(data4)){
const err25 = {instancePath:instancePath+"/createdAt",schemaPath:"#/properties/createdAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.updatedAt !== undefined){
let data5 = data.updatedAt;
if(!((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5)))){
const err26 = {instancePath:instancePath+"/updatedAt",schemaPath:"#/properties/updatedAt/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(typeof data5 == "number"){
if(data5 > 9007199254740991 || isNaN(data5)){
const err27 = {instancePath:instancePath+"/updatedAt",schemaPath:"#/properties/updatedAt/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(data5 < 0 || isNaN(data5)){
const err28 = {instancePath:instancePath+"/updatedAt",schemaPath:"#/properties/updatedAt/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.result !== undefined){
let data6 = data.result;
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
}
else {
const err29 = {instancePath:instancePath+"/result",schemaPath:"#/properties/result/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.error !== undefined){
let data7 = data.error;
const _errs18 = errors;
let valid1 = false;
const _errs19 = errors;
if(typeof data7 === "string"){
if(func2(data7) > 8192){
const err30 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 8192},message:"must NOT have more than 8192 characters"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(func2(data7) < 1){
const err31 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(!pattern33.test(data7)){
const err32 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err33 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
var _valid0 = _errs19 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs21 = errors;
if(data7 !== null){
const err34 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
var _valid0 = _errs21 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err35 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
else {
errors = _errs18;
if(vErrors !== null){
if(_errs18){
vErrors.length = _errs18;
}
else {
vErrors = null;
}
}
}
}
if(data.log !== undefined){
let data8 = data.log;
if(typeof data8 === "string"){
if(func2(data8) > 65536){
const err36 = {instancePath:instancePath+"/log",schemaPath:"#/properties/log/maxLength",keyword:"maxLength",params:{limit: 65536},message:"must NOT have more than 65536 characters"};
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
const err37 = {instancePath:instancePath+"/log",schemaPath:"#/properties/log/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data.nextOffset !== undefined){
let data9 = data.nextOffset;
if(!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))){
const err38 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(typeof data9 == "number"){
if(data9 > 9007199254740991 || isNaN(data9)){
const err39 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(data9 < 0 || isNaN(data9)){
const err40 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
validate115.errors = vErrors;
return errors === 0;
}

export const v106 = validate116;
const schema117 = {"type":"object","properties":{"operationRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"offset":{"type":"integer","minimum":0,"maximum":9007199254740991},"limit":{"type":"integer","minimum":0,"maximum":65536}},"required":["operationRef"],"additionalProperties":false};

function validate116(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operationRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationRef"},message:"must have required property '"+"operationRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "operationRef") || (key0 === "offset")) || (key0 === "limit"))){
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
if(data.operationRef !== undefined){
let data0 = data.operationRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err2 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
if(data1 > 9007199254740991 || isNaN(data1)){
const err7 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1 < 0 || isNaN(data1)){
const err8 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.limit !== undefined){
let data2 = data.limit;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err9 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 65536 || isNaN(data2)){
const err10 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 65536},message:"must be <= 65536"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err11 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
validate116.errors = vErrors;
return errors === 0;
}

export const v107 = validate117;
const schema118 = {"type":"object","properties":{"operationRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["operationRef"],"additionalProperties":false};

function validate117(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operationRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationRef"},message:"must have required property '"+"operationRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "operationRef")){
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
if(data.operationRef !== undefined){
let data0 = data.operationRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err2 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate117.errors = vErrors;
return errors === 0;
}

export const v108 = validate118;
const schema119 = {"type":"object","properties":{"artifactRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["artifactRef"],"additionalProperties":false};

function validate118(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.artifactRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "artifactRef"},message:"must have required property '"+"artifactRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "artifactRef")){
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
if(data.artifactRef !== undefined){
let data0 = data.artifactRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err2 = {instancePath:instancePath+"/artifactRef",schemaPath:"#/properties/artifactRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/artifactRef",schemaPath:"#/properties/artifactRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/artifactRef",schemaPath:"#/properties/artifactRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/artifactRef",schemaPath:"#/properties/artifactRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate118.errors = vErrors;
return errors === 0;
}

export const v109 = validate119;
const schema120 = {"type":"object","properties":{"artifactRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"submissionKey":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"grants":{"type":"array","items":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"maxItems":100},"config":{"type":"object","additionalProperties":true}},"required":["artifactRef","submissionKey"],"additionalProperties":false};

function validate119(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.artifactRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "artifactRef"},message:"must have required property '"+"artifactRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.submissionKey === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "submissionKey"},message:"must have required property '"+"submissionKey"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "artifactRef") || (key0 === "submissionKey")) || (key0 === "grants")) || (key0 === "config"))){
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
if(data.artifactRef !== undefined){
let data0 = data.artifactRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err3 = {instancePath:instancePath+"/artifactRef",schemaPath:"#/properties/artifactRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/artifactRef",schemaPath:"#/properties/artifactRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern33.test(data0)){
const err5 = {instancePath:instancePath+"/artifactRef",schemaPath:"#/properties/artifactRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err6 = {instancePath:instancePath+"/artifactRef",schemaPath:"#/properties/artifactRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.submissionKey !== undefined){
let data1 = data.submissionKey;
if(typeof data1 === "string"){
if(func2(data1) > 160){
const err7 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data1) < 1){
const err8 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern33.test(data1)){
const err9 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err10 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.grants !== undefined){
let data2 = data.grants;
if(Array.isArray(data2)){
if(data2.length > 100){
const err11 = {instancePath:instancePath+"/grants",schemaPath:"#/properties/grants/maxItems",keyword:"maxItems",params:{limit: 100},message:"must NOT have more than 100 items"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
const len0 = data2.length;
for(let i0=0; i0<len0; i0++){
let data3 = data2[i0];
if(typeof data3 === "string"){
if(func2(data3) > 160){
const err12 = {instancePath:instancePath+"/grants/" + i0,schemaPath:"#/properties/grants/items/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func2(data3) < 1){
const err13 = {instancePath:instancePath+"/grants/" + i0,schemaPath:"#/properties/grants/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern33.test(data3)){
const err14 = {instancePath:instancePath+"/grants/" + i0,schemaPath:"#/properties/grants/items/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err15 = {instancePath:instancePath+"/grants/" + i0,schemaPath:"#/properties/grants/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err16 = {instancePath:instancePath+"/grants",schemaPath:"#/properties/grants/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.config !== undefined){
let data4 = data.config;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
}
else {
const err17 = {instancePath:instancePath+"/config",schemaPath:"#/properties/config/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
else {
const err18 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
validate119.errors = vErrors;
return errors === 0;
}

export const v110 = validate120;
const schema121 = {"type":"object","properties":{"previewRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"action":{"type":"string","minLength":1,"maxLength":128,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"input":{"type":"object","additionalProperties":true},"submissionKey":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["previewRef","action","submissionKey"],"additionalProperties":false};

function validate120(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.previewRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "previewRef"},message:"must have required property '"+"previewRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.action === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "action"},message:"must have required property '"+"action"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.submissionKey === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "submissionKey"},message:"must have required property '"+"submissionKey"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "previewRef") || (key0 === "action")) || (key0 === "input")) || (key0 === "submissionKey"))){
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
if(data.previewRef !== undefined){
let data0 = data.previewRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err4 = {instancePath:instancePath+"/previewRef",schemaPath:"#/properties/previewRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func2(data0) < 1){
const err5 = {instancePath:instancePath+"/previewRef",schemaPath:"#/properties/previewRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern33.test(data0)){
const err6 = {instancePath:instancePath+"/previewRef",schemaPath:"#/properties/previewRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err7 = {instancePath:instancePath+"/previewRef",schemaPath:"#/properties/previewRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.action !== undefined){
let data1 = data.action;
if(typeof data1 === "string"){
if(func2(data1) > 128){
const err8 = {instancePath:instancePath+"/action",schemaPath:"#/properties/action/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func2(data1) < 1){
const err9 = {instancePath:instancePath+"/action",schemaPath:"#/properties/action/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern33.test(data1)){
const err10 = {instancePath:instancePath+"/action",schemaPath:"#/properties/action/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err11 = {instancePath:instancePath+"/action",schemaPath:"#/properties/action/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.input !== undefined){
let data2 = data.input;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
}
else {
const err12 = {instancePath:instancePath+"/input",schemaPath:"#/properties/input/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.submissionKey !== undefined){
let data3 = data.submissionKey;
if(typeof data3 === "string"){
if(func2(data3) > 160){
const err13 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func2(data3) < 1){
const err14 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(!pattern33.test(data3)){
const err15 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err16 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err17 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
validate120.errors = vErrors;
return errors === 0;
}

export const v111 = validate121;
const schema122 = {"type":"object","properties":{"operationRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["operationRef"],"additionalProperties":false};

function validate121(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operationRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationRef"},message:"must have required property '"+"operationRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "operationRef")){
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
if(data.operationRef !== undefined){
let data0 = data.operationRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err2 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate121.errors = vErrors;
return errors === 0;
}

export const v112 = validate122;
const schema123 = {"type":"object","properties":{"artifactRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"submissionKey":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"expectedBaseVersion":{"anyOf":[{"type":"string","minLength":1,"maxLength":100,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},{"type":"null"}]},"expectedInstallationRevision":{"type":"integer","minimum":0,"maximum":9007199254740991},"dataCompatibility":{"enum":["unchanged","migration-tested","unknown"]},"verification":{"type":"string","maxLength":8192}},"required":["artifactRef","submissionKey","expectedBaseVersion","expectedInstallationRevision","dataCompatibility"],"additionalProperties":false};

function validate122(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.artifactRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "artifactRef"},message:"must have required property '"+"artifactRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.submissionKey === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "submissionKey"},message:"must have required property '"+"submissionKey"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.expectedBaseVersion === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expectedBaseVersion"},message:"must have required property '"+"expectedBaseVersion"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.expectedInstallationRevision === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expectedInstallationRevision"},message:"must have required property '"+"expectedInstallationRevision"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.dataCompatibility === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "dataCompatibility"},message:"must have required property '"+"dataCompatibility"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "artifactRef") || (key0 === "submissionKey")) || (key0 === "expectedBaseVersion")) || (key0 === "expectedInstallationRevision")) || (key0 === "dataCompatibility")) || (key0 === "verification"))){
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
if(data.artifactRef !== undefined){
let data0 = data.artifactRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err6 = {instancePath:instancePath+"/artifactRef",schemaPath:"#/properties/artifactRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func2(data0) < 1){
const err7 = {instancePath:instancePath+"/artifactRef",schemaPath:"#/properties/artifactRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern33.test(data0)){
const err8 = {instancePath:instancePath+"/artifactRef",schemaPath:"#/properties/artifactRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err9 = {instancePath:instancePath+"/artifactRef",schemaPath:"#/properties/artifactRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.submissionKey !== undefined){
let data1 = data.submissionKey;
if(typeof data1 === "string"){
if(func2(data1) > 160){
const err10 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func2(data1) < 1){
const err11 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!pattern33.test(data1)){
const err12 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err13 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.expectedBaseVersion !== undefined){
let data2 = data.expectedBaseVersion;
const _errs7 = errors;
let valid1 = false;
const _errs8 = errors;
if(typeof data2 === "string"){
if(func2(data2) > 100){
const err14 = {instancePath:instancePath+"/expectedBaseVersion",schemaPath:"#/properties/expectedBaseVersion/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 100},message:"must NOT have more than 100 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func2(data2) < 1){
const err15 = {instancePath:instancePath+"/expectedBaseVersion",schemaPath:"#/properties/expectedBaseVersion/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(!pattern33.test(data2)){
const err16 = {instancePath:instancePath+"/expectedBaseVersion",schemaPath:"#/properties/expectedBaseVersion/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err17 = {instancePath:instancePath+"/expectedBaseVersion",schemaPath:"#/properties/expectedBaseVersion/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
var _valid0 = _errs8 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs10 = errors;
if(data2 !== null){
const err18 = {instancePath:instancePath+"/expectedBaseVersion",schemaPath:"#/properties/expectedBaseVersion/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
var _valid0 = _errs10 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err19 = {instancePath:instancePath+"/expectedBaseVersion",schemaPath:"#/properties/expectedBaseVersion/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
else {
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
}
}
if(data.expectedInstallationRevision !== undefined){
let data3 = data.expectedInstallationRevision;
if(!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))){
const err20 = {instancePath:instancePath+"/expectedInstallationRevision",schemaPath:"#/properties/expectedInstallationRevision/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(typeof data3 == "number"){
if(data3 > 9007199254740991 || isNaN(data3)){
const err21 = {instancePath:instancePath+"/expectedInstallationRevision",schemaPath:"#/properties/expectedInstallationRevision/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data3 < 0 || isNaN(data3)){
const err22 = {instancePath:instancePath+"/expectedInstallationRevision",schemaPath:"#/properties/expectedInstallationRevision/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.dataCompatibility !== undefined){
let data4 = data.dataCompatibility;
if(!(((data4 === "unchanged") || (data4 === "migration-tested")) || (data4 === "unknown"))){
const err23 = {instancePath:instancePath+"/dataCompatibility",schemaPath:"#/properties/dataCompatibility/enum",keyword:"enum",params:{allowedValues: schema123.properties.dataCompatibility.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.verification !== undefined){
let data5 = data.verification;
if(typeof data5 === "string"){
if(func2(data5) > 8192){
const err24 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/maxLength",keyword:"maxLength",params:{limit: 8192},message:"must NOT have more than 8192 characters"};
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
const err25 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err26 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
validate122.errors = vErrors;
return errors === 0;
}

export const v113 = validate123;
const schema124 = {"type":"object","properties":{"releaseRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"},"submissionKey":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["releaseRef","submissionKey"],"additionalProperties":false};

function validate123(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.releaseRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "releaseRef"},message:"must have required property '"+"releaseRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.submissionKey === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "submissionKey"},message:"must have required property '"+"submissionKey"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "releaseRef") || (key0 === "submissionKey"))){
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
if(data.releaseRef !== undefined){
let data0 = data.releaseRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err3 = {instancePath:instancePath+"/releaseRef",schemaPath:"#/properties/releaseRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/releaseRef",schemaPath:"#/properties/releaseRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern33.test(data0)){
const err5 = {instancePath:instancePath+"/releaseRef",schemaPath:"#/properties/releaseRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err6 = {instancePath:instancePath+"/releaseRef",schemaPath:"#/properties/releaseRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.submissionKey !== undefined){
let data1 = data.submissionKey;
if(typeof data1 === "string"){
if(func2(data1) > 160){
const err7 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data1) < 1){
const err8 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern33.test(data1)){
const err9 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err10 = {instancePath:instancePath+"/submissionKey",schemaPath:"#/properties/submissionKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate123.errors = vErrors;
return errors === 0;
}

export const v114 = validate124;
const schema125 = {"type":"object","properties":{"operationRef":{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000]*\\S[^\\u0000]*$"}},"required":["operationRef"],"additionalProperties":false};

function validate124(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operationRef === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationRef"},message:"must have required property '"+"operationRef"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "operationRef")){
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
if(data.operationRef !== undefined){
let data0 = data.operationRef;
if(typeof data0 === "string"){
if(func2(data0) > 160){
const err2 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern33.test(data0)){
const err4 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000]*\\S[^\\u0000]*$"},message:"must match pattern \""+"^[^\\u0000]*\\S[^\\u0000]*$"+"\""};
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
const err5 = {instancePath:instancePath+"/operationRef",schemaPath:"#/properties/operationRef/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate124.errors = vErrors;
return errors === 0;
}

export const v115 = validate125;
const schema126 = {"type":"object","properties":{"revision":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["revision"],"additionalProperties":false};

function validate125(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.revision === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "revision")){
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
if(data.revision !== undefined){
let data0 = data.revision;
if(!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))){
const err2 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(typeof data0 == "number"){
if(data0 > 9007199254740991 || isNaN(data0)){
const err3 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data0 < 0 || isNaN(data0)){
const err4 = {instancePath:instancePath+"/revision",schemaPath:"#/properties/revision/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate125.errors = vErrors;
return errors === 0;
}

export const validatorKeys = {
  "[\"moss.tasks/v1\",\"task.create\",\"input\"]": "v0",
  "[\"moss.tasks/v1\",\"task.create\",\"output\"]": "v1",
  "[\"moss.tasks/v1\",\"task.get\",\"input\"]": "v2",
  "[\"moss.tasks/v1\",\"task.get\",\"output\"]": "v1",
  "[\"moss.tasks/v1\",\"task.list\",\"input\"]": "v3",
  "[\"moss.tasks/v1\",\"task.list\",\"output\"]": "v4",
  "[\"moss.tasks/v1\",\"task.changes\",\"input\"]": "v5",
  "[\"moss.tasks/v1\",\"task.changes\",\"output\"]": "v6",
  "[\"moss.tasks/v1\",\"task.update\",\"input\"]": "v7",
  "[\"moss.tasks/v1\",\"task.update\",\"output\"]": "v1",
  "[\"moss.tasks/v1\",\"task.finish\",\"input\"]": "v8",
  "[\"moss.tasks/v1\",\"task.finish\",\"output\"]": "v1",
  "[\"moss.tasks/v1\",\"task.cancel\",\"input\"]": "v9",
  "[\"moss.tasks/v1\",\"task.cancel\",\"output\"]": "v1",
  "[\"moss.tasks/v1\",\"task.resume\",\"input\"]": "v10",
  "[\"moss.tasks/v1\",\"task.resume\",\"output\"]": "v1",
  "[\"moss.tasks/v1\",\"task.changed\",\"event\"]": "v11",
  "[\"moss.agent-execution/v1\",\"capabilities\",\"input\"]": "v12",
  "[\"moss.agent-execution/v1\",\"capabilities\",\"output\"]": "v13",
  "[\"moss.agent-execution/v1\",\"execution.start\",\"input\"]": "v14",
  "[\"moss.agent-execution/v1\",\"execution.start\",\"output\"]": "v15",
  "[\"moss.agent-execution/v1\",\"execution.get\",\"input\"]": "v16",
  "[\"moss.agent-execution/v1\",\"execution.get\",\"output\"]": "v15",
  "[\"moss.agent-execution/v1\",\"execution.list\",\"input\"]": "v17",
  "[\"moss.agent-execution/v1\",\"execution.list\",\"output\"]": "v18",
  "[\"moss.agent-execution/v1\",\"execution.cancel\",\"input\"]": "v19",
  "[\"moss.agent-execution/v1\",\"execution.cancel\",\"output\"]": "v15",
  "[\"moss.agent-execution/v1\",\"execution.events\",\"input\"]": "v20",
  "[\"moss.agent-execution/v1\",\"execution.events\",\"output\"]": "v21",
  "[\"moss.agent-execution/v1\",\"execution.result.read\",\"input\"]": "v22",
  "[\"moss.agent-execution/v1\",\"execution.result.read\",\"output\"]": "v23",
  "[\"moss.agent-execution/v1\",\"execution.changed\",\"event\"]": "v24",
  "[\"moss.mcp/v1\",\"servers.list\",\"input\"]": "v25",
  "[\"moss.mcp/v1\",\"servers.list\",\"output\"]": "v26",
  "[\"moss.mcp/v1\",\"servers.save\",\"input\"]": "v27",
  "[\"moss.mcp/v1\",\"servers.save\",\"output\"]": "v26",
  "[\"moss.mcp/v1\",\"servers.remove\",\"input\"]": "v28",
  "[\"moss.mcp/v1\",\"servers.remove\",\"output\"]": "v26",
  "[\"moss.mcp/v1\",\"servers.set-enabled\",\"input\"]": "v29",
  "[\"moss.mcp/v1\",\"servers.set-enabled\",\"output\"]": "v26",
  "[\"moss.mcp/v1\",\"servers.inspect\",\"input\"]": "v30",
  "[\"moss.mcp/v1\",\"servers.inspect\",\"output\"]": "v26",
  "[\"moss.mcp/v1\",\"auth.start\",\"input\"]": "v31",
  "[\"moss.mcp/v1\",\"auth.start\",\"output\"]": "v26",
  "[\"moss.mcp/v1\",\"auth.clear\",\"input\"]": "v32",
  "[\"moss.mcp/v1\",\"auth.clear\",\"output\"]": "v26",
  "[\"moss.local-files/v1\",\"pick\",\"input\"]": "v33",
  "[\"moss.local-files/v1\",\"pick\",\"output\"]": "v34",
  "[\"moss.local-files/v1\",\"open\",\"input\"]": "v35",
  "[\"moss.local-files/v1\",\"open\",\"output\"]": "v36",
  "[\"moss.local-files/v1\",\"reveal\",\"input\"]": "v37",
  "[\"moss.local-files/v1\",\"reveal\",\"output\"]": "v38",
  "[\"moss.runtimes/v1\",\"python.get\",\"input\"]": "v39",
  "[\"moss.runtimes/v1\",\"python.get\",\"output\"]": "v40",
  "[\"moss.platform/v1\",\"file.pick\",\"input\"]": "v41",
  "[\"moss.platform/v1\",\"file.pick\",\"output\"]": "v42",
  "[\"moss.platform/v1\",\"file.materialize\",\"input\"]": "v43",
  "[\"moss.platform/v1\",\"file.materialize\",\"output\"]": "v44",
  "[\"moss.platform/v1\",\"file.thumbnail\",\"input\"]": "v45",
  "[\"moss.platform/v1\",\"file.thumbnail\",\"output\"]": "v46",
  "[\"moss.platform/v1\",\"file.download\",\"input\"]": "v47",
  "[\"moss.platform/v1\",\"file.download\",\"output\"]": "v48",
  "[\"moss.platform/v1\",\"screen.capture\",\"input\"]": "v39",
  "[\"moss.platform/v1\",\"screen.capture\",\"output\"]": "v49",
  "[\"moss.platform/v1\",\"shell.open-external\",\"input\"]": "v50",
  "[\"moss.platform/v1\",\"shell.open-external\",\"output\"]": "v51",
  "[\"moss.audit/v1\",\"source.capture\",\"input\"]": "v39",
  "[\"moss.audit/v1\",\"source.capture\",\"output\"]": "v52",
  "[\"moss.audit/v1\",\"session.open\",\"input\"]": "v53",
  "[\"moss.audit/v1\",\"session.open\",\"output\"]": "v54",
  "[\"moss.audit/v1\",\"notification.publish\",\"input\"]": "v55",
  "[\"moss.audit/v1\",\"notification.publish\",\"output\"]": "v56",
  "[\"moss.trace/v1\",\"status\",\"input\"]": "v39",
  "[\"moss.trace/v1\",\"status\",\"output\"]": "v57",
  "[\"moss.cloud-storage/v1\",\"status.get\",\"input\"]": "v58",
  "[\"moss.cloud-storage/v1\",\"status.get\",\"output\"]": "v59",
  "[\"moss.cloud-storage/v1\",\"quota.get\",\"input\"]": "v58",
  "[\"moss.cloud-storage/v1\",\"quota.get\",\"output\"]": "v60",
  "[\"moss.cloud-storage/v1\",\"files.list\",\"input\"]": "v61",
  "[\"moss.cloud-storage/v1\",\"files.list\",\"output\"]": "v62",
  "[\"moss.cloud-storage/v1\",\"files.get\",\"input\"]": "v63",
  "[\"moss.cloud-storage/v1\",\"files.get\",\"output\"]": "v64",
  "[\"moss.cloud-storage/v1\",\"folders.create\",\"input\"]": "v65",
  "[\"moss.cloud-storage/v1\",\"folders.create\",\"output\"]": "v64",
  "[\"moss.cloud-storage/v1\",\"files.update\",\"input\"]": "v66",
  "[\"moss.cloud-storage/v1\",\"files.update\",\"output\"]": "v64",
  "[\"moss.cloud-storage/v1\",\"files.delete\",\"input\"]": "v67",
  "[\"moss.cloud-storage/v1\",\"files.delete\",\"output\"]": "v68",
  "[\"moss.cloud-storage/v1\",\"local-files.pick\",\"input\"]": "v58",
  "[\"moss.cloud-storage/v1\",\"local-files.pick\",\"output\"]": "v69",
  "[\"moss.cloud-storage/v1\",\"uploads.start\",\"input\"]": "v70",
  "[\"moss.cloud-storage/v1\",\"uploads.start\",\"output\"]": "v71",
  "[\"moss.cloud-storage/v1\",\"downloads.start\",\"input\"]": "v72",
  "[\"moss.cloud-storage/v1\",\"downloads.start\",\"output\"]": "v73",
  "[\"moss.cloud-storage/v1\",\"transfers.list\",\"input\"]": "v74",
  "[\"moss.cloud-storage/v1\",\"transfers.list\",\"output\"]": "v75",
  "[\"moss.cloud-storage/v1\",\"transfers.get\",\"input\"]": "v76",
  "[\"moss.cloud-storage/v1\",\"transfers.get\",\"output\"]": "v77",
  "[\"moss.cloud-storage/v1\",\"transfers.pause\",\"input\"]": "v78",
  "[\"moss.cloud-storage/v1\",\"transfers.pause\",\"output\"]": "v77",
  "[\"moss.cloud-storage/v1\",\"transfers.resume\",\"input\"]": "v79",
  "[\"moss.cloud-storage/v1\",\"transfers.resume\",\"output\"]": "v77",
  "[\"moss.cloud-storage/v1\",\"transfers.cancel\",\"input\"]": "v80",
  "[\"moss.cloud-storage/v1\",\"transfers.cancel\",\"output\"]": "v77",
  "[\"moss.cloud-storage/v1\",\"shares.create\",\"input\"]": "v81",
  "[\"moss.cloud-storage/v1\",\"shares.create\",\"output\"]": "v82",
  "[\"moss.cloud-storage/v1\",\"shares.list\",\"input\"]": "v83",
  "[\"moss.cloud-storage/v1\",\"shares.list\",\"output\"]": "v84",
  "[\"moss.cloud-storage/v1\",\"shares.revoke\",\"input\"]": "v85",
  "[\"moss.cloud-storage/v1\",\"shares.revoke\",\"output\"]": "v82",
  "[\"moss.cloud-storage/v1\",\"transfers.progress\",\"event\"]": "v77",
  "[\"moss.cloud-storage/v1\",\"transfers.changed\",\"event\"]": "v77",
  "[\"moss.cloud-storage/v1\",\"storage.status-changed\",\"event\"]": "v59",
  "[\"moss.host/v1\",\"capabilities.get\",\"input\"]": "v86",
  "[\"moss.host/v1\",\"capabilities.get\",\"output\"]": "v87",
  "[\"moss.host/v1\",\"info.get\",\"input\"]": "v88",
  "[\"moss.host/v1\",\"info.get\",\"output\"]": "v89",
  "[\"moss.host/v1\",\"contracts.list\",\"input\"]": "v90",
  "[\"moss.host/v1\",\"contracts.list\",\"output\"]": "v91",
  "[\"moss.host/v1\",\"contracts.get\",\"input\"]": "v92",
  "[\"moss.host/v1\",\"contracts.get\",\"output\"]": "v93",
  "[\"moss.host/v1\",\"sdk.export\",\"input\"]": "v94",
  "[\"moss.host/v1\",\"sdk.export\",\"output\"]": "v95",
  "[\"moss.apps/v1\",\"authoring.get\",\"input\"]": "v96",
  "[\"moss.apps/v1\",\"authoring.get\",\"output\"]": "v97",
  "[\"moss.apps/v1\",\"authoring.prepare\",\"input\"]": "v98",
  "[\"moss.apps/v1\",\"authoring.prepare\",\"output\"]": "v99",
  "[\"moss.apps/v1\",\"catalog.list\",\"input\"]": "v100",
  "[\"moss.apps/v1\",\"catalog.list\",\"output\"]": "v101",
  "[\"moss.apps/v1\",\"target.inspect\",\"input\"]": "v102",
  "[\"moss.apps/v1\",\"target.inspect\",\"output\"]": "v99",
  "[\"moss.apps/v1\",\"source.inspect\",\"input\"]": "v102",
  "[\"moss.apps/v1\",\"source.inspect\",\"output\"]": "v99",
  "[\"moss.apps/v1\",\"project.prepare\",\"input\"]": "v103",
  "[\"moss.apps/v1\",\"project.prepare\",\"output\"]": "v99",
  "[\"moss.apps/v1\",\"build.start\",\"input\"]": "v104",
  "[\"moss.apps/v1\",\"build.start\",\"output\"]": "v105",
  "[\"moss.apps/v1\",\"build.get\",\"input\"]": "v106",
  "[\"moss.apps/v1\",\"build.get\",\"output\"]": "v105",
  "[\"moss.apps/v1\",\"build.cancel\",\"input\"]": "v107",
  "[\"moss.apps/v1\",\"build.cancel\",\"output\"]": "v105",
  "[\"moss.apps/v1\",\"artifact.validate\",\"input\"]": "v108",
  "[\"moss.apps/v1\",\"artifact.validate\",\"output\"]": "v99",
  "[\"moss.apps/v1\",\"artifact.preview\",\"input\"]": "v109",
  "[\"moss.apps/v1\",\"artifact.preview\",\"output\"]": "v105",
  "[\"moss.apps/v1\",\"artifact.test\",\"input\"]": "v110",
  "[\"moss.apps/v1\",\"artifact.test\",\"output\"]": "v105",
  "[\"moss.apps/v1\",\"artifact.get\",\"input\"]": "v106",
  "[\"moss.apps/v1\",\"artifact.get\",\"output\"]": "v105",
  "[\"moss.apps/v1\",\"artifact.close\",\"input\"]": "v111",
  "[\"moss.apps/v1\",\"artifact.close\",\"output\"]": "v105",
  "[\"moss.apps/v1\",\"release.prepare\",\"input\"]": "v112",
  "[\"moss.apps/v1\",\"release.prepare\",\"output\"]": "v105",
  "[\"moss.apps/v1\",\"release.commit\",\"input\"]": "v113",
  "[\"moss.apps/v1\",\"release.commit\",\"output\"]": "v105",
  "[\"moss.apps/v1\",\"release.get\",\"input\"]": "v106",
  "[\"moss.apps/v1\",\"release.get\",\"output\"]": "v105",
  "[\"moss.apps/v1\",\"release.cancel\",\"input\"]": "v114",
  "[\"moss.apps/v1\",\"release.cancel\",\"output\"]": "v105",
  "[\"moss.apps/v1\",\"authoring.changed\",\"event\"]": "v115",
  "[\"moss.apps/v1\",\"operation.changed\",\"event\"]": "v105"
}
