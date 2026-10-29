'use strict';
async function retry(operation, options = {}) {
  return operation();
}
module.exports = { retry };
