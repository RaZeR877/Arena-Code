'use strict';
const {slugify}=require('./slugify');
function productUrl(name,id){return `/products/${slugify(name)}-${id}`;}
module.exports={productUrl};
