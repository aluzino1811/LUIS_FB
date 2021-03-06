// LIBRERIAS DE TERCEROS
const bodyParser = require('body-parser')
      fs = require('fs'),
      https = require('https'),
      express = require('express'),
      request = require('request'),
      console = require('better-console'),
      randomToken = require('random-token'),
      Connection = require('tedious').Connection,
      Request = require('tedious').Request,
      TYPES = require('tedious').TYPES,
      app = express();


module.exports = function(opciones){
    var clientes = 0;
    var t = this;
    t.K = opciones.kWebhook;       // KEY SSL WEBHOOK
    t.C = opciones.cWebhook;       // CERT SSL WEBHOOK
    t.P = opciones.pWebhook;       // PUERTO ASARIN
    t.I = opciones.lId;            // ID LUIS
    t.S = opciones.lSubs;          // SUBSCRIPTION KEY LUIS
    t.F = opciones.fToken;         // FACEBOOK TOKEN
    t.O = opciones.aAzure;         // IS AZURE? TRUE | FALSE
    t.A = opciones.aServer;        // DB SERVER
    t.U = opciones.aUser;          // DB USER
    t.D = opciones.aPass;          // DB PASS
    
     // ---------- FUNCIONES TEDIOUS ----------    
    var config = {
        userName: t.U,
        password: t.D,
        server: t.A,
        options: {
            encrypt: t.O, 
            database: "zmart",
            rowCollectionOnDone: true
        }
    };
    
    var connection = new Connection(config);
    var erroresConexion = 0;
    
    connection.on('connect', function (err) {
        if (err) {
            erroresConexion += 1;
            console.log("Conexion con error: " + err);
            return;
        };
        erroresConexion = 0;
        console.log("DB CONECTADA: "+t.A);
    });
    
    connection.on('end', function (err) {
          if(erroresConexion < 5)
           connection = new Connection(config);
    });
    
    // ---------- FUNCIONES EXPRESS ----------    
    const options = {
        key: fs.readFileSync(t.K),
        cert: fs.readFileSync(t.C)
    };

    var server = https.createServer(options, app);
    var io = require('socket.io')(server);

    app.use(bodyParser.json());
    
    app.get('/', function (req, res) {
        if (req.query['hub.verify_token'] === 'fGSnLGehjz' ) {
            res.send(req.query['hub.challenge']);
        } else {
            res.send('Error, wrong validation token');
        }
    });
    
    app.post('/', function(req, res) {
        var b = req.body;
        var o = b.entry[0].messaging[0];
        
        if(o.message){
            var m = o.message.text;
            var u = o.sender.id;
            var s = "m_"+o.message.mid;
            queryLUIS(m, s, u);
        }else{
            //console.log(JSON.stringify(b));
        }
        
        res.sendStatus(200);
    });
    
    // ---------- FUNCIONES SOCKET.IO ----------
    io.on('connection', function(socket) {
        clientes++;
        
        socket.on('disconnect', function () {
            clientes--;
        });
        
        socket.on('suggest', function (d) {
            suggestLUIS(d.mid, d.text);
        });
        
        socket.on('train', function (d) {
            var tk = randomToken(10);
            var r = d.respuesta;
            var e1 = d.ej1;
            var e2 = d.ej2;
            var e3 = d.ej3;
            
            newIntent(tk, d, function(){
                intentLUIS(tk, function(){
                    exampleLUIS(tk, e1, function(){
                        exampleLUIS(tk, e2, function(){
                            exampleLUIS(tk, e3, function(){
                                trainLUIS();
                            });
                        });
                    });
                });
            });
        });
        
        socket.on('sendMessage', function (d) {
            var fi = d.fbid;
            var fm = d.text;
            
            var parametros = {
                usuario: fi,
                outputs: [
                    "webhook"
                ]
            };
            ejecutarProc("luis_ObtenerWebhook", parametros, function (parametro,value) {
                if (parametro == "webhook") {
                    var wid = Number(value);
                    sendFB(fm, wid);
                }
            });
        });
        
        socket.on('sendTrain', function (d) {
            var it = d.inte;
            var ti = d.itex;
            var fi = d.fbid;
            var fm = d.text;
            
            var parametros = {
                usuario: fi,
                outputs: [
                    "webhook"
                ]
            };
            ejecutarProc("luis_ObtenerWebhook", parametros, function (parametro,value) {
                if (parametro == "webhook") {
                    var wid = Number(value);
                    exampleLUIS(it, ti, function(){
                        sendFB(fm, wid);
                        trainLUIS();
                    });
                }
            });
        });
        
        socket.on('webhook', function (d) {
            parametros = {
                usuario: d.uid,
                webhook: d.wid,
                outputs: [
                    "exitoso"
                ]
            }
            ejecutarProc("luis_AgregarWebhook", parametros, function (parametro,value) {
                if (parametro == "exitoso") {
                    console.log("WEBHOOK CREADO");
                }
            });
        });
        
        socket.on('delete', function (d) {
        });
    });
    
    // ---------- INSTANCIADO SERVIDOR ----------
    app.listen();
    server.listen(t.P, function() {
        console.log('LUIS INICIADO EN PUERTO: '+ t.P);
    });
    
    // ---------- FUNCIONES GENERICAS ----------
    function suggestLUIS(mi, query) {
        var p = {
            uri: "https://api.projectoxford.ai/luis/v1/application?id="+t.I+"&subscription-key="+t.S+"&q="+query,
            method: "GET",
        };
        
        request(p, function (error, response, b) {
            var parametros = {
                intentos: b,
                outputs: [
                    "respuestas"
                ]
            };
            ejecutarProc("luis_ObtenerRespuestas", parametros, function (parametro,value) {
                if (parametro == "respuestas") {
                    var j = JSON.parse(value);
                    j.mid = mi;
                    io.emit('suggest', j);
                }
            });
        });
    }
    
    function queryLUIS(query, m, u) {
        var p = {
            uri: "https://api.projectoxford.ai/luis/v1/application?id="+t.I+"&subscription-key="+t.S+"&q="+query,
            method: "GET",
        };
        
        request(p, function (error, response, body) {
            var b = JSON.parse(body);
            var i = b.intents[0].intent;
            var s = b.intents[0].score;
            b.mid = m;
            b.fid = u;
            
            var parametros = {
                intentos: body,
                outputs: [
                    "respuestas"
                ]
            };
            ejecutarProc("luis_ObtenerRespuestas", parametros, function (parametro,value) {
                if (parametro == "respuestas") {
                    var r = JSON.parse(value);
                    if(clientes == 0){
                        //sendFB(unescape(r.respuestas[0].respuesta), u); //ENVIAR SI NO HAY AGENTES
                    }else{
                        var res = JSON.parse(value);
                        res.mid = m;
                        res.fid = u;
                        io.emit('nuevo mensaje', res);
                    }
                }
            });
        });
    }
    
    function sendFB(mensaje, uid) {
        var p = {
            uri: "https://graph.facebook.com/v2.6/me/messages?access_token="+t.F,
            method: "POST",
            headers: {
                'Content-Type': 'application/json'
            },
            form: {
                "recipient":{
                    "id": uid
                }, 
                "message":{
                    "text": mensaje
                }
            }
        };
        
        request(p, function (error, response, body) {
            //var b = JSON.parse(body);
        });
    }
    
    function ejecutarProc(nombre, parametros, callback) {
        var query = new Request(nombre, function (err) {
            //if (err) console.log(err);
        });
        Object.keys(parametros).forEach(function (par) {
            if (par == "outputs") {
                parametros[par].forEach(function (output) {
                    query.addOutputParameter(output, TYPES.VarChar);
                });
                return;
            }
            query.addParameter(par, TYPES.VarChar, parametros[par]);
        });
        query.on('returnValue', callback);
        connection.callProcedure(query);
    }
    
    function newIntent(i, d, call){
        var parametros = {
            intento: i,
            respuesta: d.respuesta,
            outputs: [
                "exitoso"
            ]
            
        };
        ejecutarProc("luis_AgregarRespuestas", parametros, function (parametro,value) {
            if(parametro == "exitoso"){
                if(value == 1){
                    call();
                }
            }
        });
    }
    
    function intentLUIS(i, callb){
        var p = {
            uri: "https://api.projectoxford.ai/luis/v1.0/prog/apps/"+t.I+"/intents",
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': t.S
            },
            form:{
                name: i
            }                  
        };
        request(p, function (error, response, body) {
            if (!error && response.statusCode == 201) {
                console.log("INTENTO AGREGADO CORRECTAMENTE");
                setTimeout(callb, 5000);
            }else{
                //console.log("ERROR: "+ body);
            }
        });
    }
    
    function exampleLUIS(i, e, callba){
        var p = {
            uri: "https://api.projectoxford.ai/luis/v1.0/prog/apps/"+t.I+"/example",
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': t.S
            },
            form: {
              ExampleText: e,
              SelectedIntentName: i
            }
        };
        request(p, function (error, response, body) {
            if (!error && response.statusCode == 201) {
                console.log("EJEMPLO AGREGADO CORRECTAMENTE");
                setTimeout(callba, 10000);
            }else{
                //console.log("ERROR: "+ body);
            }
        });
    }
    
    function trainLUIS(){
        var p = {
            uri: "https://api.projectoxford.ai/luis/v1.0/prog/apps/"+t.I+"/train",
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': t.S
            }                
        };
        request(p, function (error, response, body) {
            if (!error && response.statusCode == 202) {
                console.log('LUIS ENTRENADO CORRECTAMENTE');
                setTimeout(publishLUIS, 10000);
            }else{
                //console.log("ERROR: "+ body);
            }
        });
    }
    
    function publishLUIS(){
        var p = {
            uri: "https://api.projectoxford.ai/luis/v1.0/prog/apps/"+t.I+"/publish",
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': t.S
            }                 
        };
        request(p, function (error, response, body) {
            if (!error && response.statusCode == 201) {
                console.log('LUIS PUBLICADO CORRECTAMENTE');
                setTimeout(function (){
                    io.emit('ready train');
                }, 15000);
            }else{
                //console.log("ERROR: "+ body);
            }
        });
    }
};
