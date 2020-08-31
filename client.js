const express = require('express');
const request = require('request');
const bodyParser = require('body-parser');
const adaro = require('adaro');
const path = require('path');
const _ = require('lodash');
const eachAsync = require('each-async');
const Levenshtein = require('levenshtein');

//判断当前字符串是否以str开始 先判断是否存在function是避免和js原生方法冲突，自定义方法的效率不如原生的高
if (typeof String.prototype.startsWith != 'function') {
    String.prototype.startsWith = function (str) {
        return this.slice(0, str.length) === str;
    };
    console.log("为String类添加startsWith方法");
}

//判断当前字符串是否以str结束
if (typeof String.prototype.endsWith != 'function') {
    String.prototype.endsWith = function (str) {
        return this.slice(-str.length) === str;
    };
    console.log("为String类添加endsWith方法");
}

/** ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- **/
var app = express();
app.engine('dust', adaro.dust({
    helpers: ['dustjs-helpers']
}));
app.set('views', path.join(__dirname, 'view'));
app.set('view engine', 'dust');
app.use(bodyParser.text({limit: '10mb'}));
app.use(bodyParser.json({limit: '10mb'}));
app.use(bodyParser.urlencoded({limit: '100mb', extended: false}));
app.use(express.static(path.join(__dirname, 'public')));
/** ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- **/
// 测试页
app.get("/", function (req, res) {
    res.status(200).render('viewpoint');
});
// 接收文本并生成主体、客体、观点
app.post("/", function (req, res) {
    console.log('----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------');
    var text = '' + req.body;  // 原文
    console.log('原始text=' + text);  //////////////////////
    var spos = {};
    var lines = text.replace(/(\n[\s\t]*\r*\n)/g, '\n').replace(/^[\n\r\n\t]*|[\n\r\n\t]*$/g, '').split('\n');
    eachAsync(lines, function(line, index, done) {
        request.post({
            url: "http://triple-svc.nlp:50000",   // http://triple.ruoben.com:8008
            headers: {
                "Content-Type": "text/plain"
            },
            body: line,
            timeout: 600000
        }, function (err, res, spo) {
            if (err) {
                done(err.toString());
            } else {
                if (res.statusCode === 200) {
                    spo = JSON.parse(spo);
                    var triples = [];
                    var init_triples = [];
                    for(var i = 0; i < spo.length; i++) {
                        triples.push(flush(spo[i]));  // 去除各种符号（只保留^）的三元组
                        init_triples.push(spo[i]);  // 原始带符号的三元组
                    }
                    spos[index] = [triples, init_triples];
                    done();
                } else {
                    done("调用triple接口报错");
                }
            }
        });
    }, function(error) {
        if (error) {
            console.error(error);
            res.header('Content-Type', 'text/plain; charset=utf-8').status(500).end(error.toString());
        } else {
            var ordered_spos = {};
            var keys = Object.keys(spos);
            keys.sort().forEach(function(key) {
                ordered_spos[key] = spos[key];
            });
            console.log('spo=' + JSON.stringify(ordered_spos));  /////////////////
            var subjects = new Array(keys.length);  // 主体
            var viewpoints = new Array(keys.length);  // 观点
            var objects = new Array(keys.length);  // 客体
            for(var line_no in ordered_spos) {
                var line_index = parseInt(line_no);
                var viewpoint_start_index = 0;  // 观点的起始下标
                for(var i=0; i<ordered_spos[line_no][0].length; i++) {
                    if ((typeof ordered_spos[line_no][0][i]['o']) !== 'string') {  // 如果宾语是[]，是一个宾语从句，一般代表观点
                        viewpoint_start_index = i;  // 找到观点的起始下标
                        break;
                    }
                }
                /*
                主体  先不去重
                */
                subjects[line_index] = '';
                for(i=viewpoint_start_index; i>=0; i--) {
                    if (ordered_spos[line_no][0][i]['s'] !== '') {
                        subjects[line_index] = ordered_spos[line_no][0][i]['s'];
                        break;
                    }
                }
                /*
                客体  先不去重
                */
                objects[line_index] = '';
                for(i=viewpoint_start_index; i<ordered_spos[line_no][0].length; i++) {
                    if (i === viewpoint_start_index) {
                        var objs = ordered_spos[line_no][0][i]['o'];
                        if ((typeof objs) === 'string') {
                            objects[line_index] = objs;
                        } else {
                            for(j=0; j<objs.length; j++) {
                                objects[line_index] = get_keti_by_subject(objs[j], subjects[line_index]);
                            }
                        }
                    } else {
                        objects[line_index] = get_keti_by_subject(ordered_spos[line_no][0][i], subjects[line_index]);
                    }
                    if (objects[line_index] !== '') {
                        break;
                    }
                }
                if (objects[line_index] === '') {
                    for(i=viewpoint_start_index; i<ordered_spos[line_no][0].length; i++) {
                        objects[line_index] = get_keti_by_object(ordered_spos[line_no][0][i]);
                        if (objects[line_index] !== '') {
                            break;
                        }
                    }
                }
                /*
                观点
                */
                viewpoints[line_index] = [];
                var dedup_spos = dedup(ordered_spos[line_no][0], ordered_spos[line_no][1]);  // 去重
                viewpoint_start_index = 1;  // 观点的起始下标，从1开始
                for(i=0; i<dedup_spos[0].length; i++) {
                    if ((typeof dedup_spos[0][i]['o']) !== 'string') {  // 如果宾语是[]，是一个宾语从句，一般代表观点
                        viewpoint_start_index = i;  // 找到观点的起始下标
                        break;
                    }
                }
                for(i=viewpoint_start_index; i<dedup_spos[0].length; i++) {
                    if ((typeof dedup_spos[0][i]['o']) === 'string') {
                        if (dedup_spos[0][i]['s'] !== '' && dedup_spos[0][i]['o'] !== '') {
                            if (dedup_spos[0][i]['p'].indexOf('^') >= 0) {
                                viewpoints[line_index].push(dedup_spos[0][i]['p'].replace(/\^/g, dedup_spos[0][i]['s']) + dedup_spos[0][i]['o']);
                            } else {
                                viewpoints[line_index].push(dedup_spos[0][i]['s'] + dedup_spos[0][i]['p'] + dedup_spos[0][i]['o']);
                            }
                        }
                    } else {  // 宾语是宾语从句，代表观点
                        var obj_str = '';
                        for(var j=0; j<dedup_spos[0][i]['o'].length; j++) {
                            obj_str += stringify_viewpoint(dedup_spos[0][i]['o'][j]) + "，";
                        }
                        if (obj_str.length > 0) {
                            obj_str = obj_str.substr(0, obj_str.length - 1);
                        }
                        if (i === viewpoint_start_index) {  // 第一个观点不加谓语
                            viewpoints[line_index].push(obj_str);
                        } else {
                            if (dedup_spos[0][i]['p'].indexOf('^') >= 0) {
                                viewpoints[line_index].push(dedup_spos[0][i]['p'].replace(/\^/g, dedup_spos[0][i]['s']) + obj_str);
                            } else {
                                viewpoints[line_index].push(dedup_spos[0][i]['p'] + obj_str);
                            }
                        }
                    }
                }
            }
            console.log("主体=" + JSON.stringify(subjects));  //////////////////
            console.log("客体=" + JSON.stringify(objects));  //////////////////
            console.log("观点=" + JSON.stringify(viewpoints));  //////////////////
            var result = '';
            for (i=1; i<=subjects.length; i++) {
                result += '<span style="line-height: 10px;">' + i + '. 主体：' + subjects[i-1] + '<br>&nbsp;&nbsp;&nbsp;&nbsp;客体：' + objects[i-1] + '<br>&nbsp;&nbsp;&nbsp;&nbsp;观点：' + JSON.stringify(viewpoints[i-1]) + '</span><br>';
            }
            console.log('结果=' + result);  /////////////////
            res.status(200).json({'viewpoint': result});
        }
    });
});
// 清洗三元组，去掉符号
function flush(spo_object) {
    var new_spo_object = {s:"", p:"", o:""};
    if ((typeof spo_object) === 'string') {
        return spo_object.replace(/{/g, "").replace(/}/g, "").replace(/\[/g, "").replace(/]/g, "").replace(/</g, "").replace(/>/g, "").replace(/《/g, "").replace(/》/g, "").replace(/`/g, "").replace(/\(/g, "").replace(/\)/g, "").replace(/~/g, "").replace(/«/g, "").replace(/»/g, "").replace(/【/g, "").replace(/】/g, "");
    } else {
        new_spo_object.s = spo_object.s.replace(/{/g, "").replace(/}/g, "").replace(/\[/g, "").replace(/]/g, "").replace(/</g, "").replace(/>/g, "").replace(/《/g, "").replace(/》/g, "").replace(/`/g, "").replace(/\(/g, "").replace(/\)/g, "").replace(/~/g, "").replace(/«/g, "").replace(/»/g, "").replace(/【/g, "").replace(/】/g, "");
        new_spo_object.p = spo_object.p.replace(/{/g, "").replace(/}/g, "").replace(/\[/g, "").replace(/]/g, "").replace(/</g, "").replace(/>/g, "").replace(/《/g, "").replace(/》/g, "").replace(/`/g, "").replace(/\(/g, "").replace(/\)/g, "").replace(/~/g, "").replace(/«/g, "").replace(/»/g, "").replace(/【/g, "").replace(/】/g, "");
        if ((typeof spo_object.o) === "string") {
            new_spo_object.o = spo_object.o.replace(/{/g, "").replace(/}/g, "").replace(/\[/g, "").replace(/]/g, "").replace(/</g, "").replace(/>/g, "").replace(/《/g, "").replace(/》/g, "").replace(/`/g, "").replace(/\(/g, "").replace(/\)/g, "").replace(/~/g, "").replace(/«/g, "").replace(/»/g, "").replace(/【/g, "").replace(/】/g, "");
        } else {
            new_spo_object.o = [];
            for(var index=0; index<spo_object.o.length; index++) {
                new_spo_object.o.push(flush(spo_object.o[index]));
            }
        }
    }
    return new_spo_object;
}
// 去重
function dedup(triples, init_triples) {
    var str_triples = [];
    for(var idx=0; idx<triples.length; idx++) {
        str_triples.push(stringify(triples[idx]));
    }
    var to_del_index = [];
    for(var i=0; i<str_triples.length; i++) {
        for(var j=i+1; j<str_triples.length; j++) {
            if (str_triples[i].indexOf(str_triples[j]) >= 0) {
                to_del_index.push(j);
            } else if (str_triples[j].indexOf(str_triples[i]) >= 0) {
                to_del_index.push(i);
            } else {
                if (str_triples[i].length > str_triples[j].length) {
                    for(var k=0; k<str_triples[i].length - str_triples[j].length + 1; k++) {
                        var substring = str_triples[i].substr(k, str_triples[j].length);
                        var ratio = 1 - new Levenshtein(str_triples[j], substring).distance / substring.length;
                        if (isNaN(ratio)) {
                            ratio = 0;
                        }
                        if (ratio >= 0.7) {
                            to_del_index.push(j);
                            break;
                        }
                    }
                } else {
                    for(var l=0; l<str_triples[j].length - str_triples[i].length + 1; l++) {
                        substring = str_triples[j].substr(l, str_triples[i].length);
                        ratio = 1 - new Levenshtein(str_triples[i], substring).distance / substring.length;
                        if (isNaN(ratio)) {
                            ratio = 0;
                        }
                        if (ratio >= 0.7) {
                            to_del_index.push(i);
                            break;
                        }
                    }
                }
            }
        }
    }
    to_del_index = _.uniq(to_del_index);
    var all_index = [];
    for(index=0; index<triples.length; index++) {
        all_index.push(index);
    }
    var retain_index = all_index.filter(function (val) { return to_del_index.indexOf(val) === -1 });
    retain_index.sort();
    var result = [];
    var init_result = [];
    for(i = 0; i<retain_index.length; i++) {
        result.push(triples[retain_index[i]]);
        init_result.push(init_triples[retain_index[i]]);
    }
    return [result, init_result];
}
// spo对象字符串化
function stringify(spo_object) {
    var s = "";
    if ((typeof spo_object) === 'string') {
        s = spo_object;
    } else {
        if (spo_object.p.indexOf('^') >= 0) {
            s = spo_object.p.replace(/\^/g, spo_object.s);
        } else {
            s = spo_object.s + spo_object.p;
        }
        if ((typeof spo_object.o) === "string") {
            s += spo_object.o;
        } else {
            for(var index=0; index<spo_object.o.length; index++) {
                s += stringify(spo_object.o[index]);
            }
        }
    }
    return s;
}
// 观点字符串化
function stringify_viewpoint(spo_object) {
    var s = "";
    if ((typeof spo_object) === 'string') {
        s = spo_object;
    } else {
        if (spo_object.p.indexOf('^') >= 0) {
            s = spo_object.p.replace(/\^/g, spo_object.s);
        } else {
            s = spo_object.s + spo_object.p;
        }
        if ((typeof spo_object.o) === "string") {
            s += spo_object.o;
        } else {
            for(var index=0; index<spo_object.o.length; index++) {
                var vp = stringify_viewpoint(spo_object.o[index]);
                if ((typeof spo_object.o[index]) === 'string' || vp.length >= 6) {
                    s += vp + "，";
                } else if (!s.endsWith('，')) {
                    s += vp + "，";
                }
            }
            if (s.length > 0) {
                s = s.substr(0, s.length - 1);
            }
        }
    }
    return s;
}
// 取spo对象中的第一个不为空的主语
function get_keti_by_subject(spo_object, subject) {
    if ((typeof spo_object) === 'string') {
        return "";
    } else {
        if (spo_object.s !== '' && spo_object.s !== '我们' && spo_object.s !== '这' && !spo_object.s.endsWith('上') && !spo_object.s.endsWith('下') && subject !=='' && spo_object.s !== subject) {
            return spo_object.s;
        }
        if ((typeof spo_object.o) !== "string") {
            for(var index=0; index<spo_object.o.length; index++) {
                var obj = get_keti_by_subject(spo_object.o[index]);
                if (obj !== '') {
                    return obj;
                }
            }
        }
        return "";
    }
}
// 取spo对象中的第一个不为空的宾语
function get_keti_by_object(spo_object) {
    if ((typeof spo_object) === 'string') {
        return "";
    } else {
        if ((typeof spo_object.o) === "string") {
            return spo_object.o;
        } else {
            for(var index=0; index<spo_object.o.length; index++) {
                var obj = get_keti_by_object(spo_object.o[index]);
                if (obj !== '') {
                    return obj;
                }
            }
            return "";
        }
    }
}

app.listen(1080, '0.0.0.0');
