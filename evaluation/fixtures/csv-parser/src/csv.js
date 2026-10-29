'use strict';
function parseCsv(text){return String(text).split(/\r?\n/).map(line=>line.split(','));}
module.exports={parseCsv};
