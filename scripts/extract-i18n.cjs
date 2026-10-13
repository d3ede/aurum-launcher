// One-time AST migration; keeps interpolated/user values outside translation keys.
const ts=require('typescript'), fs=require('fs'), path=require('path');
const keys=new Set();
const cyr=/[А-Яа-яЁё]/;
const call=(key,values=[])=>{
  keys.add(key);
  return ts.factory.createCallExpression(ts.factory.createIdentifier('t'),undefined,[ts.factory.createStringLiteral(key),...(values.length?[ts.factory.createObjectLiteralExpression(values.map((v,i)=>ts.factory.createPropertyAssignment(`v${i+1}`,v)))]:[])]);
};
function jsxText(value){
 const lines=value.split(/\r\n|\n|\r/);let last=0;lines.forEach((l,i)=>{if(/[^ \t]/.test(l))last=i;});
 return lines.map((line,i)=>{let s=line.replace(/\t/g,' ');if(i!==0)s=s.replace(/^ +/,'');if(i!==lines.length-1)s=s.replace(/ +$/,'');return s+(s&&i!==last?' ':'');}).join('');
}
function process(file){
 const original=fs.readFileSync(file,'utf8');
 const source=ts.createSourceFile(file,original,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 let changed=false;
 const result=ts.transform(source,[(context)=>{
   function visit(node,inFunction=false){
     const inner=inFunction||ts.isFunctionLike(node);
     if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['t','tMessage'].includes(node.expression.text)){
       if(node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))keys.add(node.arguments[0].text);
       return node;
     }
     if(ts.isJsxAttribute(node)&&node.initializer&&ts.isStringLiteral(node.initializer)&&cyr.test(node.initializer.text)){
       changed=true;return ts.factory.updateJsxAttribute(node,node.name,ts.factory.createJsxExpression(undefined,call(node.initializer.text)));
     }
     if(ts.isJsxText(node)&&cyr.test(node.text)){
       changed=true;return ts.factory.createJsxExpression(undefined,call(jsxText(node.text)));
     }
     if(ts.isTemplateExpression(node)&&cyr.test(node.head.text+node.templateSpans.map(s=>s.literal.text).join(''))){
       if(inner){changed=true;let key=node.head.text;const values=[];node.templateSpans.forEach((span,i)=>{key+=`{{v${i+1}}}`+span.literal.text;values.push(visit(span.expression,inner));});return call(key,values);}
     }
     if((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))&&cyr.test(node.text)){
       keys.add(node.text);if(inner){changed=true;return call(node.text);}
     }
     return ts.visitEachChild(node,(child)=>visit(child,inner),context);
   }
   return node=>visit(node);
 }]);
 if(changed){
   let output=ts.createPrinter({newLine:ts.NewLineKind.LineFeed}).printFile(result.transformed[0]);
   if(!/import\s*{[^}]*\bt\b[^}]*}\s*from\s*["'][^"']*i18n/.test(original)){
     const relative=path.relative(path.dirname(file),'src/lib/i18n').replace(/\\/g,'/');output=`import { t } from "${relative.startsWith('.')?relative:'./'+relative}";\n`+output;
   }
   const backup=path.join('.test-data/i18n/pre',file);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,original);
   if(fs.readFileSync(file,'utf8')!==original)throw Error('Concurrent change: '+file);
   fs.writeFileSync(file,output);
 }
 result.dispose();
}
function walk(dir){for(const name of fs.readdirSync(dir)){const f=path.join(dir,name);if(fs.statSync(f).isDirectory()){if(!['locales','assets'].includes(name))walk(f);}else if(/\.(ts|tsx)$/.test(name)&&!f.endsWith(path.join('lib','i18n.ts')))process(f);}}
walk('src');
// Domain label tables are kept as data and translated when read.
const domain={routes:['Главная','Мои сборки','Каталог проектов','Аккаунты и скины','Настройки'],kinds:['Моды','Модпаки','Шейдеры','Ресурспаки'],phases:['Папка данных','Метаданные','Java','Библиотеки','Ресурсы игры','Загрузчик','Контент','Модпак','Импорт','Авторизация','Вход в Microsoft']};
Object.values(domain).flat().forEach(k=>keys.add(k));
fs.mkdirSync('src/locales/messages',{recursive:true});
const catalog='src/locales/messages/ru.json';
const existing=fs.existsSync(catalog)?JSON.parse(fs.readFileSync(catalog,'utf8')):{};
fs.writeFileSync(catalog,JSON.stringify({...existing,...Object.fromEntries([...keys].sort().map(k=>[k,k]))},null,2)+'\n');
console.log('Extracted',keys.size,'translation keys');
