(function(){
	var app  = require('../app.js')
	, should = require('should')
	, request = require('supertest')
	, path = require('path')
	, fs = require('fs')
	, mongojs = require('mongojs')
	, uriUtil = require('mongodb-uri');

	var env = process.env.NODE_ENV || 'development';
	var mongourl = process.env.MONGOLAB_URI || 'mongodb://localhost/quizapp';


	describe('index', function(){
		it('should give me the index page', function(done){
			request(app)
				.get('/')
				.expect(200)
				.end(function(err, res){
					if(err)throw err;
					
					fs.readFile(path.resolve('index.html'), 'utf8', function(err, data){
						if(err) return console.error(err);
						//console.log(data);
						data.should.eql(res.text);
					});
					done();
				});
		});
	});

	describe('questions', function(){
		var db;
		
		before (function (done) {
			console.log('before hit');
			//Mongo connection
			db = mongojs(uriUtil.formatMongoose(mongourl));
			done();
		});

		after(function (done) {
			db.close();
			done();
		});
		
		it('should give me a random question', function(done){
			request(app)
				.get('/questions/current-question')
				.expect(200)
				.set('Accept', 'application/json')
				.end(function(err, res){
					var jsonBody = res.body;
					jsonBody.should.have.property('question');
					jsonBody.should.have.property('answers');
					jsonBody.answers.should.have.length(4);
					done();
				});
		});
		
		it('should give me a wrong when selecting an answer not part of the original 4 answers', function(done){
			request(app)
				.get('/questions/check-answer/4')
				.expect(200)
				.end(function(err, res){
					var jsonBody = res.body;
					jsonBody.correct.should.be.a.Boolean;
					done();
				});
		});
		
		it('should return me a JSON answer report when I ask for it', function(done){
			request(app)
				.get('/questions/check-answer/2');
			
			request(app)
				.get('/questions/answer-report')
				.expect(200)
				.end(function(err, res){
					var jsonBody = res.body;
					jsonBody.correctAnswerIndex.should.be.a.Number;
					jsonBody.should.have.property('correctAnswerIndex');
					jsonBody.should.not.have.property('correct');
					jsonBody.should.have.property('answerReport');
					done();
				});
		});
		
		
		it('should submit my question', function(done){
			request(app)
				.post('/questions/submit-question')
				.send({question: 'this is a test question coming from the test suite'
					, answer: 'this is a test answer from the test suite'
					, bogusAnswers: ['collection', 'of', 'bogus', 'answers']})
				.expect(200)
				.end(function(err, res){
					res.body.success.should.be.ok;
					done();
				});
		});
		
		it('should not allow duplicate question submissions', function(done){
			request(app)
			.post('/questions/submit-question')
			.send({question: 'this is a test question coming from the test suite'
				, answer: 'this is a test answer from the test suite'
				, bogusAnswers: ['collection', 'of', 'bogus', 'answers']})
			.expect(200)
			.end(function(err, res){
				res.body.success.should.not.be.ok;
				db.collection('questions').remove({question:'this is a test question coming from the test suite'}, true, function(err, doc){
					if(err) return console.error(err);
					done();
				});
			});
		});
		
		it('should remove questions that have MORE than ten reports', function(done){
			//1.add a test question
			request(app)
			.post('/questions/submit-question')
			.send({question: 'this is a test question coming from the test suite testing the report system'
				, answer: 'this is a test answer from the test suite'
				, bogusAnswers: ['collection', 'of', 'bogus', 'answers']})
			.expect(200)
			.end(function(err, res){
				//2. find the id of that question
				db.collection('questions').findOne({question: 'this is a test question coming from the test suite testing the report system'}, function(err, doc){
					if(err) return console.error(err);
					//3. feed the id into the api 10 times
					
					function recurseRequests(amt){
						if(amt === 10){
							if(amt === 10){
								console.log('amt reached 10');
								//4. check the db again to see if the item has been removed
								db.collection('questions').findOne({_id: doc._id}, function(err, doc){
									if(err) return console.error(err);
									console.log("DOC AFTER REMOVAL:", doc);
									(doc === null).should.be.true;
									done();
								});
								return;
							}
						}
						request(app)
						.post('/questions/report-question')
						.send({questionID: doc._id})
						.expect(200)
						.end(function(err, res){
							res.body.success.should.be.ok;
							if(amt < 10){
								recurseRequests(amt+1);
							}

						});
					}
					recurseRequests(0);
				});
			});
		});
	});

	describe('accounts', function(){
		var db;
		
		before (function (done) {
			console.log('before hit');
			//Mongo connection
			db = mongojs(uriUtil.formatMongoose(mongourl));
			//create a new user
			request(app)
			.post('/account/new-account')
			.send({username:'testsuiteuser', password:'testsuitepassword'})
			.end(function(err, res){
				if(err) console.error(err);
				res.body.success.should.be.true;
			});
			done();
		});

		after(function (done) {
			db.collection('accounts').remove({username:'testsuiteuser'});
			db.close();
			done();
		});
		
		it('should register my new account and hash my password', function(done){
			request(app)
			.post('/account/new-account')
			.send({username:'testsuiteuserfornewaccountthroughapi', password:'testsuitepassword'})
			.end(function(err, res){
				if(err) console.error(err);
				res.body.success.should.be.true;
				
				db.collection('accounts').findOne({username:'testsuiteuserfornewaccountthroughapi'}, function(err, doc){
					doc.should.have.property('username');
					doc.should.have.property('password');
					doc.password.should.not.equal('testsuitepassword');
					done();
					db.collection('accounts').remove({username:'testsuiteuserfornewaccountthroughapi'});
				});
			});
		});
		
		it("shouldn't allow to register the same account. usernames should be unique", function(done){
			request(app)
			.post('/account/new-account')
			.send({username:'testsuiteuser', password:'testsuitepassword'})
			.end(function(err, res){
				if(err) console.error(err);
				res.body.success.should.be.false;
				res.body.errorCode.should.equal(100);
				done();
			});
		});
		
		it("should allow me to login with correct credentials", function(done){
			//allows session to persist instead of creating a new request new connection
			var agent = request.agent(app);
			agent
			.post('/account/login')
			.send({username: "testsuiteuser", password:"testsuitepassword"})
			.end(function(err , res){
				if(err) return console.error(err);
				res.body.success.should.be.true;
				console.log('SET-COOKIE header', res.headers['set-cookie']);
				
				var cookie = res.header.set-cookie;
				agent.get('/session').end(function(err, res){
					console.log('SET-COOKIE header', res.headers['set-cookie']);
					res.body.should.have.property('username', 'testsuiteuser');
					done();
				});
			});
		});
		
		it('should not allow me to login with wrong credentials', function(done){
			request(app)
			.post('/account/login')
			.send({username:'asodinvklasn', password:'aksdlvkasndvoi'})
			.end(function(err, res){
				if(err) return console.error(err);
				res.body.success.should.be.false;
				res.body.errorCode.should.equal(101);
				done();
			});
		});
		
		it('should allow me to logout when logged in', function(done){
			//persist the session with agent
			var agent = request.agent(app);
			agent
			.get('/account/logout')
			.end(function(err, res){
				agent.get('/session').end(function(err, res){
					console.log("USERNAME:", res.body.username);
					res.body.username.should.be.not.ok;
					done();
				});
			});
		});
	});

	//describe('app', function () {
	//	
//		before (function (done) {
//			console.log('before hit');
//			this.server = app.listen(port, function (err, result) {
//				if (err) {
//					done(err);
//				} else {
//					done();
//				}
//			});
//		});
	//	
//		after(function (done) {
//			this.timeout(12000);
//			console.log('after hit');
//			this.server.close(function(){
//				console.log('server has been closed');
//				done();
//			});
//			
//			console.log('after hook complete hit');
//		});
	//
//		it('should exist', function (done) {
//			should.exist(app);
//			done();
//		});
	//
//		it('should be listening at localhost:3333', function (done) {
//			var headers = defaultGetOptions('/');
//			http.get(headers, function (res) {
//				console.log('hit get /');
//				res.statusCode.should.eql(200);
//				done();
//			});
//		});
	//	
//		function defaultGetOptions(path) {
//			var options = {
//					"host": "localhost",
//					"port": port,
//					"path": path,
//					"method": "GET",
//					"headers": {
//						//"Cookie": sessionCookie
//					}
//			};
//			return options;
//		}
	//});
})();

