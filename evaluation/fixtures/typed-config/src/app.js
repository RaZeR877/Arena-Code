'use strict';
const {loadConfig}=require('./config');
function createAppConfig(env){return loadConfig(env,{PORT:3000,DEBUG:false,APP_NAME:'Arena'});}
module.exports={createAppConfig};
