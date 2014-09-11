(function(){
	var app = angular.module('quizApp', ['ngResource']);
	
	
	app.controller('AppController', ['$scope', 'sharedProperties', 'Session', 'Account', function($scope, sharedProperties, Session, Account){
		var that = this;
		this.loginFormVisible = true;
		this.questionFormVisible = true;
		this.newAccountFormVisible = false;
		this.aboutContentVisible = true;
		this.session = sharedProperties.session;
		this.toggleLoginVisibility = function(){
			this.loginFormVisible = true;
			this.newAccountFormVisible = false;
		};
		this.toggleNewAccountFormVisibility = function(){
			this.newAccountFormVisible = true;
			this.loginFormVisible = false;
		};
		this.toggleQuestionFormVisibility = function(){
			this.questionFormVisible = !this.questionFormVisible;
		};
		this.toggleAboutContentVisibility = function(){
			this.aboutContentVisible = !this.aboutContentVisible;
		};
		this.hideAccountBox = function(){
			this.loginFormVisible = false;
			this.newAccountFormVisible = false;
		};
		//TODO: complete logout behavior, delete session?
		this.logout = function(){
			Account.logout.get().$promise.then(function(data){
				console.log("Account Logout data:", data);
				if(data.success === true){
					sharedProperties.session.resetDefault();
				}
			}, function(err){
				console.log(err);
			});
		};	
		this.debugLogin = function(){
			sharedProperties.session.loggedIn = true;
			sharedProperties.session.username = "debug";
		};
		this.debugLogout = function(){
			sharedProperties.session.loggedIn = false;
			sharedProperties.session.username = undefined;
		};
		
		//Refresh session
		Session.getSession.get().$promise.then(function(session){
			if(session){
				that.session.loggedIn = session.loggedIn;
				that.session.username = session.username;
				that.session.points = session.points;
				that.session.questionsAnswered = session.questionsAnswered;
				that.session.questionsCorrect = session.questionsCorrect;
				that.session.answerSubmitted = session.answerSubmitted;
				that.session.selectedAnswer = session.selectedAnswer;
			}
		}, function(err){
			console.log(err);
		});

	}]);
	
	app.controller('LoginController', ['$scope', 'sharedProperties', 'Account', 'Session', 'ErrorCodes', '$timeout', function($scope, sharedProperties, Account, Session, ErrorCodes, $timeout){
		var that = this;
		this.clickedButton = "";
		this.validation = {
				submitted: false,
				usernameTaken: false,
				usernameNotFound: false,
				newAccountSuccess: false,
				loginSuccess: false
		};
		this.processAccountForm = function(){
			console.log('hi');
			console.log(this.username);
			console.log(this.submit);
			if(this.clickedButton === "login"){
				loginSubmit();
			}
			else if(this.clickedButton === "register"){
				newAccountSubmit();
			};
			this.validation.submitted = true;
		};
		var loginSubmit = function(){
			var login = new Account.login({username: that.username, password: that.password});
			login.$save(function(data, headers){
				if(!data.success){
					if(data.errorCode === ErrorCodes.usernameNotFound){
						$scope.loginForm.username.$setValidity('usernameNotFound', false);
						usernameNotFound = true;
					}
					console.error(data.msg);
				}
				else{
					$scope.loginForm.username.$setValidity('usernameNotFound', true);
					sharedProperties.session.loggedIn = true;
					sharedProperties.session.username = that.username;
					that.validation.submitted = false;
					that.validation.loginSuccess = true;
					Session.getSession.get().$promise.then(function(data){
						sharedProperties.session.points = data.points;
						sharedProperties.session.questionsAnswered = data.questionsAnswered;
						sharedProperties.session.questionsCorrect = data.questionsCorrect;
					}, function(err){
						console.error(err);
					});
					
					$timeout(function(){
						resetForm(); 
						$('.modal').modal('hide');
						}, 2500);
				}
			});
		};
		var newAccountSubmit = function(){
			var acct = new Account.newAccount({username: that.username, password: that.password});
			acct.$save(function(data, headers){
				if(!data.success){
					if(data.errorCode === ErrorCodes.usernameTaken){
						that.validation.usernameTaken = true;
						$scope.loginForm.username.$setValidity('usernameTaken', false);
					}
				}
				else{
					$scope.loginForm.username.$setValidity('usernameTaken', true);
					that.registrationSuccess = true;
					that.validation.submitted = false;
					that.validation.newAccountSuccess = true;
					loginSubmit();
				}
			});
			
		};
		
		var resetForm = function(){
			that.password = '';
			that.username = '';
			that.validation.submitted = false;
			that.validation.loginSuccess = false;
			that.validation.newAccountSuccess = false;
		};
	}]);
	
	app.controller('NewQuestionController', ['Question', function(Question){
		
	}]);
	
	app.controller('QuestionController', ['Question', '$interval', '$timeout', 'sharedProperties', '$element', function(Question, $interval, $timeout, sharedProperties, $element){
		/*
		 * The questionCycle works like this
		 * Phase0. Reset quiz for new question
		 * Phase1. Question offered
		 * Phase2. lock in and verify answer
		 * Phase3. Answer validated, wait until next question
		 */
		
		var that = this;
		this.session = sharedProperties.session;
		var QUESTION_REFRESH_TIMER = 30000;
		this.question = "";
		this.answers = [];
		this.author = "anonymous";
		this.questionID = "";
		this.reported = false;
		//this.selectedAnswer = this.session.selectedAnswer || undefined;
		this.correct = undefined;
		this.correctAnswerIndex = undefined;
		this.timeToAnswerQuestion = 0;
		this.timeToNextQuestion = 0;
		//this.answerSubmitted = this.session.answerSubmitted || undefined;
		this.answerReport = undefined;
		this.isSelected = function(index){
			return index === this.session.selectedAnswer;
		};

		
		console.log(sharedProperties.session);
		
		var grabQuestion = function(){
			Question.getQuestion.get().$promise.then(function(question){
				that.question = question.question;
				that.answers = question.answers;
				that.author = question.author || "anonymous";
				that.questionID = question.questionID;
				console.log(question);
				that.timeToAnswerQuestion = question.timeToAnswerQuestion / 1000;
				that.timeToNextQuestion = question.timeToNextQuestion / 1000;
				triggerCountdownTimers();
			}, function(err){
				console.error(err);
			});
		};
		var resetSelected = function(){
			that.session.selectedAnswer = undefined;
			that.session.answerSubmitted = undefined;
			that.correct = undefined;
			that.correctAnswerIndex = undefined;
			that.answerReport = undefined;
			that.reported = false;
		};
		
		var triggerCountdownTimers = function(){
			if(that.timeToAnswerQuestion > 0){
				$interval(function(){
					that.timeToAnswerQuestion -= 1;
					//when answer time period over
					if(that.timeToAnswerQuestion === 0){
						getAnswerReport();
					}
				}, 1000, that.timeToAnswerQuestion);
			}

			$interval(function(){
				that.timeToNextQuestion -= 1;
				//when question time period over
				if(that.timeToNextQuestion === 0){
					resetSelected();
					grabQuestion();
				}
			}, 1000, that.timeToNextQuestion);
		};

		
		this.submitAnswer = function($index){
			console.log('submitAnswer hit with', $index, 'index');
			console.log('this.session.answerSubmitted == ', this.session.answerSubmitted);
			if(this.session.answerSubmitted === undefined && this.timeToAnswerQuestion > 0){
				sharedProperties.session.selectedAnswer = $index;
				sharedProperties.session.answerSubmitted = true;
				sharedProperties.session.questionsAnswered += 1;
				Question.submitAnswer.get({answerNum: $index}).$promise.then(function(validate){
					that.correct = validate.correct;
				});
			}
		};
		
		this.reportQuestion = function(questionID){
			console.log('questionID to report', questionID);
			//pretty sure I'm abusing the $providers.
			(new Question.reportQuestion({questionID: questionID})).$save(function(data, headers){});
			that.reported = true;
		};
		
		var getAnswerReport = function(){
			Question.getAnswerReport.get({}).$promise.then(function(answerReport){
				that.correctAnswerIndex = answerReport.correctAnswerIndex;
				that.answerReport = answerReport.answerReport;
				if(that.correct === true){
					sharedProperties.session.questionsCorrect += 1;
					sharedProperties.session.points += answerReport.answerReport.pointValue;
				}
				
				}, function(err){
					console.log(err);
				}
			);
		};

		grabQuestion();
	}]);

	
	
	app.directive('questionSubmitForm', ['Question', 'sharedProperties', '$timeout', '$compile',
        function(Question, sharedProperties, $timeout, $compile){
        	return{
        		restrict: "E",
        		replace: "true",
        		templateUrl: "/template/bogus-input.html",
        		link: function(scope, element, attrs){
        			scope.success = undefined;
        			scope.bogusAnswers = [undefined, undefined, undefined];
        			scope.additionalBogusAnswers = [];
        			scope.formSubmitted = false;
        			scope.addBogusAnswerField = function(){
        				scope.additionalBogusAnswers.push('');
        			};
        			
        			scope.removeExtraBogusAnswer = function(index){
        				scope.additionalBogusAnswers.splice(index, 1);
        			};
        			
        			scope.submit = function(){
        				var newQuestion = new Question.submitQuestion({question: scope.question, answer: scope.answer, bogusAnswers: scope.bogusAnswers.concat(scope.additionalBogusAnswers), author: sharedProperties.session.username});
        				newQuestion.$save(function(data, header){
        					if(data.success === true){
        						console.log('question submitted');
        						scope.success = true;
        						$timeout(function(){scope.resetForm();}, 3000);
        					}
        					else{
        						console.log('question submit failure');
        						scope.success = false;
        						$timeout(function(){scope.success = undefined;}, 3000);
        					}
        				});
        			};
        			
        			scope.resetForm = function(){
        				scope.additionalBogusAnswers = [];
        				scope.formSubmitted = false;
        				scope.bogusAnswers = [undefined, undefined, undefined];
        				scope.success = undefined;
        				
        				scope.newQuestionForm.$setPristine();
        				
        				scope.question = '';
        				scope.answer = '';
        			};
        		}
        	};
        }
    ]);
	
	app.directive('questionPreview', [
		  function(){
			  return{
				  restrict: 'E',
				  replace: true,
				  templateUrl: "/template/question-preview.html"
			  };
		  }
	]);
	
	app.directive('uniqueValues', function(){
		return{
			restrict: "A",
			require: 'ngModel',
			link: function(scope, elem, attr, ctrl){
				console.log('unique-values hit');
				elem.on('blur', function(){
					
					//at this point, with the way the arrays need to be split up in to two due to the X click feature,
					//we'll need to double check both arrays when there's a change to an index.
					//redundant, inefficient. But can't think of another easy way.
					if(elem.attr('name') !== 'answer'){
						var arrClone = scope.bogusAnswers.slice().concat(scope.additionalBogusAnswers);
						if(arrClone.indexOf(arrClone.splice(scope.$index, 1)[0]) != -1){
							//duplicate entry found
							ctrl.$setValidity('uniqueValues', false);
						}
						else{
							ctrl.$setValidity('uniqueValues', true);
						}
						arrClone = scope.additionalBogusAnswers.slice().concat(scope.bogusAnswers);
						if(arrClone.indexOf(arrClone.splice(scope.$index, 1)[0]) != -1){
							//duplicate entry found
							ctrl.$setValidity('uniqueValues', false);
						}
						else{
							ctrl.$setValidity('uniqueValues', true);
						}
						
						//checking bogus answers to answer
						if(elem.val() === scope.answer){
							ctrl.$setValidity('notAnswerDuplicate', false);
						}
						else{
							ctrl.$setValidity('notAnswerDuplicate', true);
						}
					}
					else{
						//checking answer to bogus answers
						(scope.bogusAnswers.indexOf(elem.val()) !== -1 || scope.additionalBogusAnswers.indexOf(elem.val()) !== -1 ? ctrl.$setValidity('notAnswerDuplicate', false) : ctrl.$setValidity('notAnswerDuplicate', true));
					}
					
					return;
				});
			}
		};
	});
	
	app.directive('answer', function(){
		return {
			restrict: 'A',
			link: function(scope, elem, attr){
				console.log('elem', elem);
				console.log(scope.timeToAnswerQuestion);
				scope.$watch('questionCtrl.timeToAnswerQuestion', function(newValue, oldValue){
					if(newValue === 0){
						elem.triggerHandler('blur');
					}
				});
			}
		};
	});
	
	app.directive('tooltip', function(){
		return{
			restrict: 'A',
			link: function(scope, elem, attr){
				console.log($(elem));
				$(elem).tooltip();
			}
		};
	});

	app.directive('aboutContent', [
		  function(){
			  return{
				  restrict: 'E',
				  replace: true,
				  templateUrl: "/template/about-content.html"
			  };
		  }
	]);
	
	app.factory('sharedProperties', function() {
		return {
			session: {
				loggedIn: false,
				username: "",
				points: 0,
				questionsAnswered: 0,
				questionsCorrect: 0,
				answerSubmitted: undefined,
				selectedAnswer: undefined,
				resetDefault: function(){
					this.loggedIn = false;
					this.username = "";
					this.points = 0;
					this.questionsAnswered = 0;
					this.questionsCorrect = 0;
					this.answerSubmitted = false;
					this.selectedAnswer = undefined;
				}
			}
		};
	});
	
	app.factory('Account', ['$resource', function ($resource){
		var account = {};
		account.newAccount = $resource('/account/new-account');
		account.login = $resource('/account/login');
		account.logout = $resource('/account/logout');
		return account;
	}]);
	
	app.factory('Question', ['$resource', function($resource){
		var question = {};
		question.getQuestion = $resource('/questions/current-question');
		question.getAnswerReport = $resource('/questions/answer-report');
		question.submitAnswer = $resource('/questions/check-answer/:answerNum');
		question.submitQuestion = $resource('/questions/submit-question');
		question.reportQuestion = $resource('/questions/report-question');
		return question;
	}]);
	
	app.factory('Session', ['$resource', function($resource){
		var resource = {};
		resource.getSession = $resource('/session');
		return resource;
	}]);

	
	app.value('ErrorCodes', {
		usernameTaken: 100,
		usernameNotFound: 101
	});
})();

