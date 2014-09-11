(function(){
	var express = require('express')
	, app = express()
	, path = require('path')
	, bodyParser = require('body-parser')
	, server = require('http').createServer(app)
	, mongoose = require('mongoose')
	, uriUtil = require('mongodb-uri')
	, cookieParser = require('cookie-parser')
	, session = require('express-session')
	, MongoStore = require('connect-mongo')(session)
	, sessionKey = require('./private/secrets.js').sessionKey
	, bcrypt = require('bcrypt')
	, seedrandom = require('seedrandom')
	, clone = require('clone')
	, SALT_WORK_FACTOR = 10
	, QUESTION_TIMER_CYCLE = 30000;
	
	//use module.exports when exporting objects, arrays, groups of stuff.
	//use exports when only exporting a single attr
	//http://www.hacksparrow.com/node-js-exports-vs-module-exports.html
	module.exports = app;

	//this list of error codes is to be updated with the angular app.
	//maybe in the future we have an api endpoint to get a list of error codes.
	var errorCodes = {
			usernameTaken: 100,
			usernameNotFound: 101
	};
	
	/*
	 * assign Express configurations
	 */
	console.log(process.env.TEST_VAL);
	
	var env = process.env.NODE_ENV || 'development';
	var mongourl = (process.env.NODE_ENV === 'production' ? 'mongodb://heroku_app28994643:lv5ddleuhq05itp4i45lgajs68@ds053218.mongolab.com:53218/heroku_app28994643' : 'mongodb://localhost/quizapp');
	var port = process.env.PORT || 5000;
	
	//this if check prevents the server from listening if it has been executed from a separate test suite
	//no parent means its being ran directly
	//yes parent means its being ran indirectly from a test suite, so don't run it...
	if(!module.parent){
		server.listen(port);
		console.log('express server running on port: %d \r\n in env: %s \r\n using mongo url: %s', port, env, mongourl);
	}
	
	app.use(bodyParser.json());
	app.use('/', express.static(path.resolve('./public')));
	app.use(cookieParser(sessionKey));
	app.use(session({
		  store: new MongoStore({
		    url: mongourl,
		    auto_reconnect: true
		  }),
		  secret: sessionKey
		}));
	app.use(function(err, req, res, next){
	  if (!err) return next();
	  console.error('ERROR', err);
	  res.send(500);
	});
	/*
	 * database connection + schemas
	 */
	var mongooseUri = uriUtil.formatMongoose(mongourl);
	mongoose.connect(mongooseUri);

	var AccountSchema = new mongoose.Schema({  
		username: {type: String, required: true, index: {unique: true}, validate: /([0-9A-Za-z_~-])+/},
		password: {type: String, required: true},
		points: {type: Number, required: false, 'default': 0},
		questionsAnswered: {type: Number, required: false, 'default': 0},
		questionsCorrect: {type: Number, required: false, 'default': 0},
		questionsSubmitted: {type: Number, required: false, 'default': 0},
		joinDate: {type: Date, required: true}
	});
	AccountSchema.pre('save', function(next){
		var account = this;
		// only hash the password if it has been modified (or is new)
	    if (!account.isModified('password')) return next();

	    // generate a salt
	    bcrypt.genSalt(SALT_WORK_FACTOR, function(err, salt) {
	        if (err) return next(err);

	        // hash the password along with our new salt
	        bcrypt.hash(account.password, salt, function(err, hash) {
	            if (err) return next(err);

	            // override the cleartext password with the hashed one
	            account.password = hash;
	            next();
	        });
	    });
	});
	AccountSchema.methods.comparePassword = function(candidatePassword, callback){
		bcrypt.compare(candidatePassword, this.password, function(err, isMatch){
			if(err) return callback(err);
			callback(null, isMatch);
		});
	};
	var AccountModel = mongoose.model('Account', AccountSchema);
	
	var QuestionSchema = new mongoose.Schema({
		question: {type: String, required: true, index: {unique: true}},
		bogusAnswers: {type: Array, required: true},
		answer: {type: String, required: true},
		author: {type: String, required: true},
		random: {type: Number, required: true},
		reports: {type: Number, required: false, 'default': 0}
	});
	QuestionSchema.index({ random: 1 });
	var QuestionModel = mongoose.model('Question', QuestionSchema);
	
	/*
	 * questionManager
	 */
	var questionManager = (function(){
		var that = this;
		var randomSeededFloatOfCurrentMinute = Math.random();
		this.currentQuestion = {};
		this.answerReport = {};
		this.answerKey = 0;
		this.questionStartTime;
		
		var refreshQuestion = function(){
		that.questionStartTime = Date.now();
		//console.log('starting refreshQuestion, questionStartTime: ', that.questionStartTime);
		var date = new Date();
		randomSeededFloatOfCurrentMinute = seedrandom(date.getFullYear().toString() 
			+ date.getMonth().toString() 
			+ date.getDate().toString() 
			+ date.getHours().toString() 
			+ date.getMinutes().toString()
			+ (parseInt(date.getSeconds() / (QUESTION_TIMER_CYCLE / 1000))).toString())();
		
		QuestionModel.findOne({random: {$gte: randomSeededFloatOfCurrentMinute}}, function(err, questionAnswer){
			if(err){
				console.error(err);
			}
			else if(questionAnswer === null){
				QuestionModel.findOne({random: {$lte: randomSeededFloatOfCurrentMinute}}, function(err, questionAnswer){
					if(err){
						console.error(err);
					}
					else{
						that.currentQuestion = massageQuestion(questionAnswer);
//						console.log('questions answer:', questionAnswer);
//						console.log('current question:', that.currentQuestion);
					}
				});
			}
			else{
				that.currentQuestion = massageQuestion(questionAnswer);
//				console.log('questions answer:', questionAnswer);
//				console.log('current question:', that.currentQuestion);
			}
		});
		resetAttributes();
		};
		
		var massageQuestion = function(questionAnswer){
			if(questionAnswer){
				var finalQuestion = {};
				var MAX_BOGUS_QUESTIONS = 3;
				
				finalQuestion.questionID = questionAnswer._id;
				//did you know that copied arrays are passed by reference?
				//changing them will update the original array, unless you pass it with .slice() which will pass it by value
				var copyOfBogusAnswers = questionAnswer.bogusAnswers.slice();
				finalQuestion.question = questionAnswer.question;
				finalQuestion.answers = [questionAnswer.answer];
				for(var i = 0; i < MAX_BOGUS_QUESTIONS; i++){
					var randomIndex = Math.floor(Math.random() * copyOfBogusAnswers.length);
					finalQuestion.answers.push(copyOfBogusAnswers[randomIndex]);
					copyOfBogusAnswers.splice(randomIndex, 1);
				}
				finalQuestion.answers.sort();
				that.answerKey = finalQuestion.answers.indexOf(questionAnswer.answer);
				
				//console.log('Answer Key Index', that.answerKey);
				return finalQuestion;
			}
			else{
				return { question: 'This is a placeholder when there are no questions in the database, go add some questions!',
					  answers: 
						   [ '1',
						     '2',
						     '3',
						     '4' ] };

			}
		};
		
		var resetAttributes = function(){
			that.answerReport = {numGuesses: 0, numCorrect: 0, guessedA: 0, guessedB: 0, guessedC: 0, guessedD: 0};
		};
		
		
		resetAttributes();
		refreshQuestion();
		setInterval(refreshQuestion, QUESTION_TIMER_CYCLE);
		return this;
	})();
	
	/*
	 * Session Object
	 * reason why session object was created was to save some database calls...
	 * even though it may take up slightly more memory, I believe its faster than consulting the database after every question
	 */
	
	var sessionManager = {
			points: 0,
			username: '',
			loggedIn: false,
			questionsAnswered: 0,
			questionsCorrect: 0,
			questionsSubmitted: 0,
			answerSubmitted: undefined,
			selectedAnswer: undefined,
			resetSession: function(req){
				req.session.points = this.points;
				req.session.username = this.username;
				req.session.loggedIn = this.loggedIn;
				req.session.questionsAnswered = this.questionsAnswered;
				req.session.questionsCorrect = this.questionsCorrect;
				req.session.questionsSubmitted = this.questionsSubmitted;
				req.session.answerSubmitted = this.answerSubmitted;
				req.session.selectedAnswer = this.selectedAnswer;
			}
	};
	
	/*
	 * assign api route connections
	 */
	app.get('/', function(req, res){
		//create a new default session if the current one doesn't exist
		if(req.session.points === undefined){
			console.log('session is brand new, give it session defaults');
			sessionManager.resetSession(req);
			console.log('session defaults set', req.session);
		}
		res.sendfile(path.resolve('./index.html'));
		console.log('homepage hit, current session', req.session);
	});
	app.get('/questions/current-question', function(req, res){
		var timeToAnswerQuestion = 0;
		var timeToNextQuestion = Math.ceil((QUESTION_TIMER_CYCLE - (Date.now() - questionManager.questionStartTime))/1000) * 1000;;
		if(timeToNextQuestion - (QUESTION_TIMER_CYCLE / 3) > 0){
			timeToAnswerQuestion = timeToNextQuestion - (QUESTION_TIMER_CYCLE / 3);
		} else{
			timeToAnswerQuestion = 0;
		}
		questionManager.currentQuestion.timeToAnswerQuestion = timeToAnswerQuestion;
		questionManager.currentQuestion.timeToNextQuestion = timeToNextQuestion;
		res.json(questionManager.currentQuestion);
	});
	app.get('/questions/check-answer/', function(req, res){
		console.log('GET /questions/check-answer hit');
		res.json({correct: false, answerReport: questionManager.answerReport});
	});
	app.get('/questions/check-answer/:answerID', function(req, res){
		//console.log('GET /questions/check-answer/', req.params.answerID, 'hit');
		questionManager.answerReport.numGuesses += 1;
		req.session.questionsAnswered += 1;
		req.session.answerSubmitted = true;
		req.session.selectedAnswer = parseInt(req.params.answerID);
		switch(parseInt(req.params.answerID)){
			case 0:
				questionManager.answerReport.guessedA += 1;
				break;
			case 1:
				questionManager.answerReport.guessedB += 1;
				break;
			case 2:
				questionManager.answerReport.guessedC += 1;
				break;
			case 3:
				questionManager.answerReport.guessedD += 1;
				break;
		}
		if(parseInt(req.params.answerID) === questionManager.answerKey){
			questionManager.answerReport.numCorrect += 1;
			req.session.questionsCorrect += 1;
			questionManager.answerReport.pointValue = 5 + questionManager.answerReport.numGuesses - questionManager.answerReport.numCorrect;
			req.session.points += questionManager.answerReport.pointValue;
			if(req.session.loggedIn === true){
				//TODO: I think you got to work on your points saving logic.
            	AccountModel.findOne({username: req.session.username}, function(err, user){
            		if(err){
            			console.error(err);
            		}
            		else{
            			req.session.points += user.points;
            		}
            	});
            	//console.log("questionsCorrect: " , req.session.questionsCorrect);
            	var updatedAccount = {points: req.session.points, questionsAnswered: req.session.questionsAnswered, questionsCorrect: req.session.questionsCorrect};
            	//console.log('account to be updated:', req.session.username, 'with these values', updatedAccount);
            	AccountModel.update({username: req.session.username}, updatedAccount,function(err, account){
            		console.log('account updated:', account);
            	});
			}
			res.json({correct:true});
		}
		else{
			if(req.session.loggedIn === true){
				//console.log('account to be updated:', req.session.username, 'with these values', {questionsAnswered: req.session.questionsAnswered});
	        	AccountModel.update({username: req.session.username}, {questionsAnswered: req.session.questionsAnswered},function(err, account){
	        		console.log('account updated:', account);
	        	});
			}
			questionManager.answerReport.pointValue = 5 + questionManager.answerReport.numGuesses - questionManager.answerReport.numCorrect;
    		res.json({correct:false});
		}
	});
	
	app.get('/questions/answer-report', function(req, res){
		questionManager.answerReport.pointValue = 5 + questionManager.answerReport.numGuesses - questionManager.answerReport.numCorrect;
		req.session.answerSubmitted = undefined;
		req.session.selectedAnswer = undefined;
		res.json({correctAnswerIndex: questionManager.answerKey, answerReport: questionManager.answerReport});
	});
	
	app.post('/questions/submit-question', function(req, res){
		var question = new QuestionModel({
			question: req.body.question,
			answer: req.body.answer,
			bogusAnswers: req.body.bogusAnswers,
			author: req.session.username || 'anonymous',
			random: Math.random(),
			reports: 0
		});
		question.save(function(err){
			if(!err){
				console.log(req.body);
				console.log('question created!');
				res.json({success: true});
			}
			else{
				console.error(err);
				res.json({success: false});
			}
		});
	});
	app.post('/questions/report-question', function(req, res){
		QuestionModel.findOne({_id: req.body.questionID}, function(err, question){
			if(err) return console.error(err);
			if(question){
				console.log('adding report to question');
				question.reports += 1;
				console.log('question now has', question.reports, 'reports');
				if(question.reports >= 10){
					console.log('question _id', question._id, 'reached 10 reports will be removed');
					question.remove(function(err, question){
						if(err) return console.error(err);
						console.log('question has been removed');
					});
				}
				question.save(function(err){
					if(err) return console.error(err);
					res.json({success:true});
				});
			}
		});
	});
	app.post('/account/new-account', function(req, res){
		console.log('/account/new-account has been hit');
		console.log('session before creating the new account', req.session);
		if(req.body.username && req.body.password){
			var newAccount = new AccountModel({
				username: req.body.username.toLowerCase(),
				password: req.body.password,
				points: 0,
				questionsAnswered: 0,
				questionsCorrect: 0,
				questionsSubmitted: 0,
				joinDate: new Date()
			});
			console.log('new account to create', newAccount);
			newAccount.save(function(err){
				if(err){
					var errorObj = {};
					if(err.code === 11000){
						errorObj.msg = "Username already exists";
						errorObj.errorCode = errorCodes.usernameTaken;
					}
					else{
						errorObj.msg = err.message;
					}
					console.error(err);
					errorObj.success = false;
					res.json(errorObj);
				}
				else{
					console.log("/account/new-account/ registration successful " + req.body.username);
					res.json({success: true});
				}
			});
		}
		else{
			res.json({success: false});
		}
	});
	app.post('/account/login', function(req, res){
		console.log('/account/login hit');
		if(!!req.body.username && !!req.body.password){
			console.log('/account/login checking for username and password', req.body);
			AccountModel.findOne({username: req.body.username.toLowerCase()}, function(err, account) {
		        if (err) throw err;
		        if(account){
		        	console.log('/account/login found corresponding account');
			        account.comparePassword(req.body.password, function(err, isMatch) {
			            if (err) throw err;
			            if(isMatch){
			            	//there an error here where a new user will have their points added twice?
			            	console.log('/account/login username pass match');
			            	req.session.loggedIn = true;
			            	req.session.username = req.body.username;
			            	console.log('/account/login points in session: ', req.session.points);
			            	account.points += req.session.points;
			            	req.session.points = account.points;
			            	account.questionsAnswered += req.session.questionsAnswered;
			            	req.session.questionsAnswered = account.questionsAnswered;
			            	account.questionsCorrect += req.session.questionsCorrect;
			            	req.session.questionsCorrect = account.questionsCorrect;
			            	console.log('/account/login account to save', account);
			            	account.save(function(err){
			            		if(err){
			            			console.log('/account/login error while saving user', account);
			            			console.error(err);
			            		}
			            	});
			            	console.log('login successful', req.session);
			            	res.json({success: true});
			            }
			            else{
			            	res.json({success: false, errorCode: errorCodes.usernameNotFound, errorMsg: 'Account credentials were not found'});
			            }
			        });
		        }
		        else{
		        	res.json({success: false, errorCode: errorCodes.usernameNotFound, errorMsg: 'Account credentials were not found'});
		        }
		    });
		}
        else{
        	res.json({success: false, errorMsg: 'No credentials supplied'});
        }
	});
	app.get('/account/logout', function(req, res){
		//TODO: discover if this destroys session in session store?
		console.log('/account/logout hit');
		req.session.regenerate(function(err){
			if(err){
				console.error(err);
			}
			console.log('session cleared after being regenerated', req.session);
			sessionManager.resetSession(req);
			console.log('session after being reset to defaults', req.session);
			res.json({success: true});
		});
	});
	app.get('/profile/:username', function(req, res){
		AccountModel.findOne({username: req.params.username}, function(err, account){
			if(err){
				console.error(err);
			}
			else{
				console.log(account);
				res.json(account);
			}
		});
	});
	app.get('/session', function(req, res){
		console.log('GET /session, returning session', req.session);
		res.send(req.session);
	});
})();