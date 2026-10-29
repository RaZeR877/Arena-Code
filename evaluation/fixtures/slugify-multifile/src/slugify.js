'use strict';
function slugify(value){return String(value).toLowerCase().replace(/\s+/g,'-');}
module.exports={slugify};
