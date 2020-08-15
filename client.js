const express = require('express');
const request = require('request');
const bodyParser = require('body-parser');
const adaro = require('adaro');
const path = require('path');
const _ = require('lodash');
const eachAsync = require('each-async');
const Levenshtein = require('levenshtein');
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
// 接收文本并生成摘要和脑图
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
                        triples.push(flush(spo[i]));  // 去除各种符号的三元组
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
            Object.keys(spos).sort().forEach(function(key) {
                ordered_spos[key] = spos[key];
            });
            console.log('spo=' + JSON.stringify(ordered_spos));  /////////////////
            var viewpoint = '';
            for(var line_no in ordered_spos) {
                var viewpoint_start_index = -1;  // 观点的起始下标
                for(i=0; i<ordered_spos[line_no][0].length; i++) {
                    if ((typeof ordered_spos[line_no][0][i]['o']) !== 'string') {  // 如果宾语是[]，是一个宾语从句，一般代表观点
                        viewpoint_start_index = i;  // 找到观点的起始下标
                        break;
                    }
                }
                /*
                主体  先不要去重
                */
                var subject = '';
                for(var i=0; i<ordered_spos[line_no][0].length; i++) {
                    if (ordered_spos[line_no][0][i]['s'] && ordered_spos[line_no][0][i]['s'] !== '' && i <= viewpoint_start_index) {
                        subject = ordered_spos[line_no][0][i]['s'];
                        break;
                    }
                }
                /*
                客体  先不要去重
                */
                var object = '';
                for(i=0; i<ordered_spos[line_no][0].length; i++) {
                    if (ordered_spos[line_no][0][i]['o'] && (typeof ordered_spos[line_no][0][i]['o']) === 'string' && ordered_spos[line_no][0][i]['o'] !== '' && i < viewpoint_start_index) {
                        object = ordered_spos[line_no][0][i]['o'];
                        break;
                    }
                }
                /*
                观点
                */
                var viewpoints = [];
                var dedup_spos = dedup(ordered_spos[line_no][0], ordered_spos[line_no][1]);  // 去重
                viewpoint_start_index = -1;  // 观点的起始下标
                for(i=0; i<dedup_spos[0].length; i++) {
                    if ((typeof dedup_spos[0][i]['o']) !== 'string') {  // 如果宾语是[]，是一个宾语从句，一般代表观点
                        viewpoint_start_index = i;  // 找到观点的起始下标
                        break;
                    }
                }
                for(i=viewpoint_start_index; i<dedup_spos[0].length; i++) {
                    if ((typeof dedup_spos[0][i]['o']) === 'string') {
                        viewpoints.push(dedup_spos[0][i]['s'] + dedup_spos[0][i]['p'] + dedup_spos[0][i]['o']);
                    } else {  // 宾语是宾语从句，代表观点
                        var obj_str = '';
                        var object_clause = false;
                        for(var j=0; j<dedup_spos[0][i]['o'].length; j++) {
                            if ((typeof dedup_spos[0][i]['o'][j]) !== 'string') {
                                object_clause = true;
                            }
                            obj_str += stringify(dedup_spos[0][i]['o'][j]);
                        }
                        if (object_clause) {
                            viewpoints.push(obj_str);
                        } else {
                            viewpoints.push(dedup_spos[0][i]['p'] + obj_str);
                        }
                    }
                }
                var no = parseInt(line_no) + 1;  // 段落号
                viewpoint += '<span style="line-height: 10px;">' + no + '. 主体：' + subject + '<br>&nbsp;&nbsp;&nbsp;&nbsp;客体：' + object + '<br>&nbsp;&nbsp;&nbsp;&nbsp;观点：' + JSON.stringify(viewpoints) + '</span><br>';
            }
            console.log('viewpoint=' + viewpoint);  /////////////////
            res.status(200).json({'viewpoint': viewpoint});
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
                        if (ratio >= 0.5) {
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
                        if (ratio >= 0.5) {
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
        s = spo_object.s + spo_object.p;
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

app.listen(1080, '0.0.0.0');
