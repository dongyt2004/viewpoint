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
    console.log('text=' + text);  //////////////////////
    var spos = {};
    var lines = text.replace(/(\n[\s\t]*\r*\n)/g, '\n').replace(/^[\n\r\n\t]*|[\n\r\n\t]*$/g, '').split('\n');
    eachAsync(lines, function(line, index, done) {
        request.post({
            url: "http://triple.ruoben.com:8008",   // http://triple-svc.nlp:50000
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
                    for(var i = 0; i < spo.length; i++) {
                        if (spo[i].s && spo[i].s !== '' && spo[i].p && spo[i].p !== '' && spo[i].o && spo[i].o !== '') {
                            triples.push(flush(spo[i]));
                        }
                    }
                    spos[index] = dedup(triples);
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
                var no = parseInt(line_no) + 1;  // 段落号
                var subject = '';  // 主体
                var object = '';  // 客体
                var viewpoints = [];  // 观点
                for(var i=0; i<ordered_spos[line_no].length; i++) {
                    if (subject === '') {
                        if (ordered_spos[line_no][i]['s'].indexOf('【') >= 0) {
                            subject = ordered_spos[line_no][i]['s'];
                            if ((typeof ordered_spos[line_no][i]['o']) === 'string') {
                                object = ordered_spos[line_no][i]['o'];
                            }
                        }
                    } else {
                        var ratio = 1 - new Levenshtein(ordered_spos[line_no][i]['s'], subject).distance / Math.max(ordered_spos[line_no][i]['s'].length, subject.length);
                        if (isNaN(ratio)) {
                            ratio = 0;
                        }
                        if (ordered_spos[line_no][i]['s'].length > 2 && (subject.indexOf(ordered_spos[line_no][i]['s']) >= 0 || ordered_spos[line_no][i]['s'].indexOf(subject) >= 0)) {
                            continue;
                        } else if (ratio > 0.6) {
                            continue;
                        } else {
                            viewpoints.push(ordered_spos[line_no][i]['s'] + ordered_spos[line_no][i]['p'] + ordered_spos[line_no][i]['o']);
                        }
                    }
                }
                viewpoint += '<span style="line-height: 10px;">' + no + '. 主体：' + subject + '<br>&nbsp;&nbsp;&nbsp;&nbsp;客体：' + object + '<br>&nbsp;&nbsp;&nbsp;&nbsp;观点：' + JSON.stringify(viewpoints) + '</span><br>';
            }
            console.log('viewpoint=' + viewpoint);  /////////////////
            res.status(200).json({'viewpoint': viewpoint});
        }
    });
});
// 清洗三元组，去掉符号
function flush(spo_object) {
    if ((typeof spo_object) === 'string') {
        return spo_object.replace(/{/g, "").replace(/}/g, "").replace(/\[/g, "").replace(/]/g, "").replace(/</g, "").replace(/>/g, "").replace(/《/g, "").replace(/》/g, "").replace(/`/g, "").replace(/\(/g, "").replace(/\)/g, "").replace(/~/g, "").replace(/«/g, "").replace(/»/g, "").replace(/【/g, "").replace(/】/g, "");
    } else {
        spo_object.s = spo_object.s.replace(/{/g, "").replace(/}/g, "").replace(/\[/g, "").replace(/]/g, "").replace(/</g, "").replace(/>/g, "").replace(/《/g, "").replace(/》/g, "").replace(/`/g, "").replace(/\(/g, "").replace(/\)/g, "").replace(/~/g, "").replace(/«/g, "").replace(/»/g, "").replace(/【/g, "").replace(/】/g, "");
        spo_object.p = spo_object.p.replace(/{/g, "").replace(/}/g, "").replace(/\[/g, "").replace(/]/g, "").replace(/</g, "").replace(/>/g, "").replace(/《/g, "").replace(/》/g, "").replace(/`/g, "").replace(/\(/g, "").replace(/\)/g, "").replace(/~/g, "").replace(/«/g, "").replace(/»/g, "").replace(/【/g, "").replace(/】/g, "");
        if ((typeof spo_object.o) === "string") {
            spo_object.o = spo_object.o.replace(/{/g, "").replace(/}/g, "").replace(/\[/g, "").replace(/]/g, "").replace(/</g, "").replace(/>/g, "").replace(/《/g, "").replace(/》/g, "").replace(/`/g, "").replace(/\(/g, "").replace(/\)/g, "").replace(/~/g, "").replace(/«/g, "").replace(/»/g, "").replace(/【/g, "").replace(/】/g, "");
        } else {
            for(var index=0; index<spo_object.o.length; index++) {
                spo_object.o[index] = flush(spo_object.o[index]);
            }
        }
    }
    return spo_object;
}
// 去重
function dedup(triples) {
    var to_del_index = [];
    for(var i=0; i<triples.length; i++) {
        var str_i = stringify(triples[i]);
        for(var j=i+1; j<triples.length; j++) {
            var str_j = stringify(triples[j]);
            if (str_i.indexOf(str_j) >= 0) {
                to_del_index.push(j);
            } else if (str_j.indexOf(str_i) >= 0) {
                to_del_index.push(i);
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
    for(i = 0; i<retain_index.length; i++) {
        result.push(triples[retain_index[i]]);
    }
    return result;
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
