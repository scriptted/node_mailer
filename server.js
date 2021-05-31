const http = require("http");
const host = 'localhost';
const port = 11000;
const qs = require('querystring');


const mailjet = require ('node-mailjet')
.connect(process.env.MJ_APIKEY_PUBLIC, process.env.MJ_APIKEY_PRIVATE)

const requestListener = function (request, response) {
    response.setHeader("Content-Type", "application/json");
    switch (request.url) {
        case "/mail":
            if (request.method == 'POST') {
                var body = '';

                request.on('data', function (data) {
                    body += data;

                    // Too much POST data, kill the connection!
                    // 1e6 === 1 * Math.pow(10, 6) === 1 * 1000000 ~~~ 1MB
                    if (body.length > 1e6)
                        request.connection.destroy();
                });

                request.on('end', function() {
                    var post = qs.parse(body);
                    const mailing = mailjet
                    .post("send", {'version': 'v3.1'})
                    .request({
                        "Messages":[{
                            "From": {
                                "Email": "contact@therapie-vr.fr",
                                "Name": "Thérapie VR Dijon"
                            },
                            "To": [{
                                "Email": "contact@therapie-vr.fr",
                            }],
                            "Subject": post.object,
                            "TextPart": "Auteur : " + post.name + " - " + post.email +"\n Message : " + post.message,
                            "HTMLPart": "<b>Auteur :</b> " + post.name + " - " + post.email +"<br /> <b>Message :</b> " + post.message.replace(/\r?\n/g, '<br />'),
                        }]
                    })
                    mailing
                    .then((result) => {
                        console.log(result)
                        response.writeHead(302, {
                            'Location': process.env.CONTACT_URL
                        });
                        response.end();
                    })
                    .catch((err) => {
                        response.writeHead(404);
                        response.end(JSON.stringify({error:err}));
                    })
                })
                
            }
            break
        default:
            response.writeHead(404);
            response.end(JSON.stringify({error:"Resource not found"}));
    }
}

const server = http.createServer(requestListener);
server.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
});
