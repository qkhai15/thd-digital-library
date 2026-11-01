const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
// Load project TypeScript in memory; tests never connect to the school database.
function loader(stubs = {}) {
  const cache = new Map();
  function load(filename) {
    const resolved = path.resolve(filename);
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const compiledModule = {exports:{}};
    cache.set(resolved,compiledModule);
    const code = ts.transpileModule(fs.readFileSync(resolved,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const customRequire = name => {
      if (Object.hasOwn(stubs,name)) return stubs[name];
      const projectModule = filename => load(fs.existsSync(filename) ? filename : fs.existsSync(filename+'.ts') ? filename+'.ts' : filename+'.tsx');
      if (name.startsWith('@/')) return projectModule(path.join('src',name.slice(2)));
      if (name.startsWith('.')) return projectModule(path.resolve(path.dirname(resolved),name));
      return require(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename:resolved})(customRequire,compiledModule,compiledModule.exports);
    return compiledModule.exports;
  }
  return load;
}

module.exports = loader;
