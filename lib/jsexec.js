/* -*- Mode: JS; tab-width: 4; indent-tabs-mode: nil; -*-
 * vim: set sw=4 ts=4 et tw=78:
/* ***** BEGIN LICENSE BLOCK *****
 *
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Narcissus JavaScript engine.
 *
 * The Initial Developer of the Original Code is
 * Brendan Eich <brendan@mozilla.org>.
 * Portions created by the Initial Developer are Copyright (C) 2004
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Narcissus - JS implemented in JS.
 *
 * Execution of parse trees.
 *
 * Standard classes except for eval, Function, Array, and String are borrowed
 * from the host JS environment.  Function is metacircular.  Array and String
 * are reflected via wrapping the corresponding native constructor and adding
 * an extra level of prototype-based delegation.
 */

//TODO var x = <H>y;
//<H>new Object
//functions

Narcissus.interpreter = (function() {

    var parser = Narcissus.parser;
    var definitions = Narcissus.definitions;
    var hostGlobal = Narcissus.hostGlobal;
    var L = definitions.L;
    var H = definitions.H;

    // Set constants in the local scope.
    eval(definitions.consts);

    const GLOBAL_CODE = 0, EVAL_CODE = 1, FUNCTION_CODE = 2;

    function ExecutionContext(type, pc) {
        this.type = type;
        this.pc = pc;
    }

    function isStackOverflow(e) {
        var re = /InternalError: (script stack space quota is exhausted|too much recursion)/;
        return re.test(e.toString());
    }

    // The underlying global object for narcissus.
    var narcissusGlobal = {
        // Value properties.
        NaN: NaN, Infinity: Infinity, undefined: undefined,

        // Function properties.
        eval: function eval(s) {
            if (typeof s !== "string")
                return s;

            var x = ExecutionContext.current;
            var x2 = new ExecutionContext(EVAL_CODE, x.pc);
            x2.thisObject = x.thisObject;
            x2.caller = x.caller;
            x2.callee = x.callee;
            x2.scope = x.scope;
            try {
                x2.execute(parser.parse(s));
                return x2.result;
            } catch (e if e instanceof SyntaxError || isStackOverflow(e)) {
                /*
				 * If we get an internal error during parsing we need to reify
				 * the exception as a Narcissus THROW.
				 * 
				 * See bug 152646.
				 */
                x.result = e;
                throw THROW;
            }
        },

        // Class constructors. Where ECMA-262 requires C.length === 1, we
		// declare
        // a dummy formal parameter.
        Function: function Function(dummy) {
            var p = "", b = "", n = arguments.length;
            if (n) {
                var m = n - 1;
                if (m) {
                    p += arguments[0];
                    for (var k = 1; k < m; k++)
                        p += "," + arguments[k];
                }
                b += arguments[m];
            }

            // XXX We want to pass a good file and line to the tokenizer.
            // Note the anonymous name to maintain parity with Spidermonkey.
            var t = new parser.Tokenizer("anonymous(" + p + ") {" + b + "}");

            // NB: Use the STATEMENT_FORM constant since we don't want to push
			// this
            // function onto the fake compilation context.
            var f = parser.FunctionDefinition(t, null, false, parser.STATEMENT_FORM);
            var s = {lo: global, hi: {}, base: mkGlobalBase(global), parent: null};
            return newFunction(f,{scope:s});
        },
        Array: function (dummy) {
            // Array when called as a function acts as a constructor.
            return Array.apply(this, arguments);
        },
        String: function (s) {
            // Called as function or constructor: convert argument to string
			// type.
            s = arguments.length ? "" + s : "";
            if (this instanceof String) {
                // Called as constructor: save the argument as the string value
                // of this String object and return this object.
                this.value = s;
                return this;
            }
            return s;
        },

        // Don't want to proxy RegExp or some features won't work
        RegExp: RegExp,

        // Extensions to ECMA.
        load: function load(s) {
            if (typeof s !== "string")
                return s;

            evaluate(snarf(s), s, 1)
        },
        version: function() { return Narcissus.options.version; },
        quit: function() { throw END; },
        print: function(v) {
            if (v instanceof LabeledValue)
                print("<" + v.k + ">" + v.r);
            else
                print(v);
        }
    };

    function mkGlobalBase(g) {
        var base = {};
        for (var prop in g)
            base[prop] = g;
        return base;
    }

    // Create global handler with needed modifications.
    var globalHandler = definitions.makePassthruHandler(narcissusGlobal);
    globalHandler.has = function(name) {
        if (name in narcissusGlobal) { return true; }
        // Hide Narcissus implementation code.
        else if (name === "Narcissus") { return false; }
        else { return (name in hostGlobal); }
    };
    globalHandler.get = function(receiver, name) {
        if (narcissusGlobal.hasOwnProperty(name))
            return narcissusGlobal[name];

        var globalFun = hostGlobal[name];
        if (definitions.isNativeCode(globalFun)) {
            // Enables native browser functions like 'alert' to work correctly.
            return Proxy.createFunction(
                definitions.makePassthruHandler(globalFun),
                function() { return globalFun.apply(hostGlobal, arguments); },
                function() {
                    var a = arguments;
                    switch (a.length) {
                      case 0:
                        return new globalFun();
                      case 1:
                        return new globalFun(a[0]);
                      case 2:
                        return new globalFun(a[0], a[1]);
                      case 3:
                        return new globalFun(a[0], a[1], a[2]);
                      default:
                        var argStr = "";
                        for (var i=0; i<a.length; i++) {
                            argStr += 'a[' + i + '],';
                        }
                        return eval('new ' + name + '(' + argStr.slice(0,-1) + ');');
                    }
                });
        }
        else { return globalFun; };
    };

    var global = Proxy.create(globalHandler);

    // Helper to avoid Object.prototype.hasOwnProperty polluting scope objects.
    function hasDirectProperty(o, p) {
        return Object.prototype.hasOwnProperty.call(o, p);
    }

    // Reflect a host class into the target global environment by delegation.
    function reflectClass(name, proto) {
        var gctor = global[name];
        definitions.defineProperty(gctor, "prototype", proto, true, true, true);
        definitions.defineProperty(proto, "constructor", gctor, false, false, true);
        return proto;
    }

    // Reflect Array -- note that all Array methods are generic.
    reflectClass('Array', new Array);

    // Reflect String, overriding non-generic methods.
    var gSp = reflectClass('String', new String);
    gSp.toSource = function () { return this.value.toSource(); };
    gSp.toString = function () { return this.value; };
    gSp.valueOf  = function () { return this.value; };
    global.String.fromCharCode = String.fromCharCode;

    ExecutionContext.current = null;

    ExecutionContext.prototype = {
        caller: null,
        callee: null,
        scope: {lo: global, hi: {}, base: mkGlobalBase(global), parent: null},
        get scopeSpace() {
            return this.pc === L ? this.scope.lo : this.scope.hi;
        },
        thisObject: global,
        result: undefined,
        target: null,
        ecma3OnlyMode: false,
        // Execute a node in this execution context.
        execute: function(n) {
            var prev = ExecutionContext.current;
            ExecutionContext.current = this;
            try {
                execute(n, this);
            } catch (e if e === THROW) {
                // Propagate the throw to the previous context if it exists.
                if (prev) {
                    prev.result = this.result;
                    throw THROW;
                }
                // Otherwise reflect the throw into host JS.
                throw this.result;
            } finally {
                ExecutionContext.current = prev;
            }
        }
    };

    function LabeledValue(r, k) {
        this.r = r;
        this.k = k;
    }

    function Reference(base, propertyName, node) {
        this.base = base;
        this.propertyName = propertyName;
        this.node = node;
    }

    Reference.prototype.toString = function () { return this.node.getSource(); }

    function lookupReference(r) {
        if (!r.base) {
            throw new ReferenceError(r.propertyName + " is not defined",
                                     r.node.filename, r.node.lineno);
        }
        return r.base[r.propertyName];
    }
    
    
    /*
	 * This functions takes a function and extracts the values from x and y and
	 * then applys the function to x and y.
	 * 
	 * 
	 * 
	 */
    function liftOp(cmp) {
    	  return function(left, right) {
    	    if (left instanceof LabeledValue) left = left.r;
    	    if (right instanceof LabeledValue) right = right.r;
    	    return cmp(left, right);
    	  }
    	}
    
    function liftUnaryOp(cmp) {
  	  return function(left) {
  	    if (left instanceof LabeledValue) left = left.r;
  	    return cmp(left);
  	  }
  	}

    /*
	 * Reference and value representation in Narcissus sparse-label
	 * 
	 * Value ::= RawValue | LabeledValue of RawValue * Label
	 * 
	 * That is, references are always labeled, but values might or might not be
	 * labeled.
	 */

    function getRawValue(v) {
        var r = v instanceof LabeledValue ? v.r : v;
        return r instanceof Reference ? lookupReference(r) : r;
     }
    function getValueFromLabelValue(t){
    	if(t instanceof LabeledValue){
    		return t.r;
    	}else{
    		return t;
    	}
    	
    }

    function getLabel(v, s) {
        // Slow-path: label on v.
        if (v instanceof LabeledValue) {
            let r = v.r;
            // If the current value has a label also, join them.
            if (r instanceof Reference) {
                let cell = lookupReference(r);
                if (cell instanceof LabeledValue)
                    return joinLabel(cell.k, v.k);
            }
            return v.k;
        }

        // Fast-path: no label on v.
        if (v instanceof Reference) {
            let cell = lookupReference(v);
            // If the value has a label, use that.
            if (cell instanceof LabeledValue)
                return cell.k;
            // If not, use the implicit store label.
            return v.base === s.lo ? L : H;
        }
        return null;
    }

    function putValue(v, w, vn) {
        var r = v instanceof LabeledValue ? v.r : v;
        
        if (r instanceof Reference) {
            return (r.base || global)[r.propertyName] = w;
        }
        throw new ReferenceError("Invalid assignment left-hand side",
                                 vn.filename, vn.lineno);
    }

    function isPrimitive(vr) {
        var t = typeof vr;
        return (t === "object") ? vr === null : t !== "function";
    }

    function isObject(vr) {
        var t = typeof vr;
        return (t === "object") ? vr !== null : t === "function";
    }

    // If r instanceof Reference, v === getRawValue(r); else v === r. If passed,
	// rn
    // is the node whose execute result was r.
    function toObject(vr, r, rn) {
        switch (typeof vr) {
          case "boolean":
            return new global.Boolean(vr);
          case "number":
            return new global.Number(vr);
          case "string":
            return new global.String(vr);
          case "function":
            return vr;
          case "object":
            if (vr !== null)
                return vr;
        }
        var message = r + " (type " + (typeof vr) + ") has no properties";
        throw rn ? new TypeError(message, rn.filename, rn.lineno)
                 : new TypeError(message);
    }

    // Naive linear lattice assumption.
    function valuateLabel(k) {
        return definitions.labels[k];
    }

    function joinLabel(k1, k2) {
    	if(!k1 && !k2){
    		return L;
    	}else if(!k1){
    		return k2;
    	}else if(!k2){
    		return k1;
    	}else{
    		return valuateLabel(k1) < valuateLabel(k2) ? k2 : k1;
    	}
        
    }
    

    function relabelValue(v, k, pc) {
        var r, l;
        if (v instanceof LabeledValue) {
            r = v.r;
            l = v.k;
        } else {
            r = v;
            l = null;
        }

        if (valuateLabel(k) <= valuateLabel(pc))
            return v;
        return new LabeledValue(r, l ? joinLabel(k, l) : k);
    }

    function isSlowPath(d, x) {
        var k = getLabel(d, x.scope);
        return k && (k !== x.pc);
    }

    function execute(n, x) {
        var a, c, d, f, i, j, k, m, r, s, t, u, w;
        var oldpc, slow;
        var rawValueWhile, whileD, dLeft, dRight, dExec;
        var funcStorage;
        
        
        switch (n.type) {
          case FUNCTION:
            if (n.functionForm !== parser.DECLARED_FORM) {
                if (!n.name || n.functionForm === parser.STATEMENT_FORM) {
                    r = newFunction(n, x);
                    if (n.functionForm === parser.STATEMENT_FORM) {
                        definitions.defineProperty(x.scopeSpace, n.name, r, true);
                        x.scope.base[n.name] = x.scopeSpace;
                    }
                } else {
                    let lo = new Object;
                    let hi = new Object;
                    t = x.pc === H ? hi : lo;
                    x.scope = {lo: lo, hi: hi, base: {}, parent: x.scope};
                    try {
                        r = newFunction(n, x);
                        definitions.defineProperty(t, n.name, r, true, true);
                        x.scope.base[n.name] = t;
                    } finally {
                        x.scope = x.scope.parent;
                    }
                }
            }
            break;

          case SCRIPT:
            t = x.scopeSpace;
            a = n.funDecls;
            for (i = 0, j = a.length; i < j; i++) {
                s = a[i].name;
                f = newFunction(a[i], x);
                definitions.defineProperty(t, s, f, x.type !== EVAL_CODE);
                x.scope.base[s] = t;
            }
            a = n.varDecls;
            for (i = 0, j = a.length; i < j; i++) {
                u = a[i];
                s = u.name;
                if (u.readOnly && hasDirectProperty(t, s)) {
                    throw new TypeError("Redeclaration of const " + s,
                                        u.filename, u.lineno);
                }
                if (u.readOnly || !hasDirectProperty(t, s)) {
                    // Does not correctly handle 'const x;' -- see bug 592335.
                    definitions.defineProperty(t, s, undefined,
                                               x.type !== EVAL_CODE, false);
                    x.scope.base[s] = t;
                }
            }
            // FALL THROUGH

          case BLOCK:
            c = n.children;
            for (i = 0, j = c.length; i < j; i++)
                execute(c[i], x);
            break;

          case IF:
            d = execute(n.condition, x);
            
            if (slow = isSlowPath(d, x)) {
                oldpc = x.pc;
                x.pc = joinLabel(x.pc, getLabel(d, x.scope));
              
            }

            if (getRawValue(d))
                execute(n.thenPart, x);
            else if (n.elsePart)
                execute(n.elsePart, x);

            if (slow) {
                x.pc = oldpc;
            }
            break;

          case SWITCH:
        	  d = execute(n.discriminant, x);
        	   if (slow = isSlowPath(d, x)) {
                   oldpc = x.pc;
                   x.pc = joinLabel(x.pc, getLabel(d, x.scope));
                 
               }
        	  s = getRawValue(d);
            
            a = n.cases;
            var matchDefault = false;
          switch_loop:
            for (i = 0, j = a.length; ; i++) {
                if (i === j) {
                    if (n.defaultIndex >= 0) {
                        i = n.defaultIndex - 1; // no case matched, do default
                        matchDefault = true;
                        continue;
                    }
                    break;                      // no default, exit switch_loop
                }
                t = a[i];                       // next case (might be default!)
                if (t.type === CASE) {
                	 u = getRawValue(execute(t.caseLabel, x));
                	 
                } else {
                    if (!matchDefault)          // not defaulting, skip for now
                        continue;
                    u = s;                      // force match to do default
                }
                if (u === s) {
                    for (;;) {                  // this loop exits switch_loop
                        if (t.statements.children.length) {
                            try {
                                execute(t.statements, x);
                            } catch (e if e === BREAK && x.target === n) {
                                break switch_loop;
                            }
                        }
                        if (++i === j)
                            break switch_loop;
                        t = a[i];
                    }
                    // NOT REACHED
                }
            }
            if (slow) {
                x.pc = oldpc;
            }
            break;

          case FOR:
            n.setup && getRawValue(execute(n.setup, x));
            // FALL THROUGH
          case WHILE:
        	 
        	whileD = execute(n.condition, x);
           	rawValueWhile =  getRawValue(whileD);  
           	
            while (!n.condition || rawValueWhile) {
            	// label handeling
            	if (slow = isSlowPath(whileD, x)) {
                    oldpc = x.pc;
                    x.pc = joinLabel(x.pc, getLabel(whileD, x.scope));
                }
            	
                try {
                    execute(n.body, x);
                } catch (e if e === BREAK && x.target === n) {
                    break;
                } catch (e if e === CONTINUE && x.target === n) {
                    // Must run the update expression.
                }
                n.update && getRawValue(execute(n.update, x));
                // reset the pc after everloop
                if (slow) {
                    x.pc = oldpc;
                }
                // set conditions for starting while loop
                whileD = execute(n.condition, x); 
            	rawValueWhile =  getRawValue(whileD);
            }
            break;
           //todo 
          case FOR_IN:
            u = n.varDecl;
            if (u)
                execute(u, x);
            w = n.iterator;
            s = execute(n.object, x);
            r = getRawValue(s);

            // ECMA deviation to track extant browser JS implementation
			// behavior.
            t = ((r === null || r === undefined) && !x.ecma3OnlyMode)
              ? r
              : toObject(r, s, n.object);
            a = [];
            for (i in t)
                a.push(i);
            for (i = 0, j = a.length; i < j; i++) {
                putValue(execute(w, x), a[i], w);
                
                if (slow = isSlowPath(s, x)) {
                    oldpc = x.pc;
                   x.pc = joinLabel(x.pc, getLabel(s, x.scope));
               }
                try {
                    execute(n.body, x);
                } catch (e if e === BREAK && x.target === n) {
                    break;
                } catch (e if e === CONTINUE && x.target === n) {
                    continue;
                }
                if (slow) {
                   x.pc = oldpc;
                }
            }
            break;

          case DO:
        	var firstPass =0;
            do {
            	if (firstPass >0 && (slow = isSlowPath(whileD, x))) {
                    oldpc = x.pc;
                    x.pc = joinLabel(x.pc, getLabel(whileD, x.scope));
                }
                try {
                    execute(n.body, x);
                } catch (e if e === BREAK && x.target === n) {
                    break;
                } catch (e if e === CONTINUE && x.target === n) {
                    continue;
                }
                if (slow && firstPass >0) {
                    x.pc = oldpc;
                }
                firstPass++;
                whileD = execute(n.condition, x);
                rawValueWhile =  getRawValue(whileD);
            } while (rawValueWhile);
            break;

          case BREAK:
          case CONTINUE:
            x.target = n.target;
            throw n.type;

          case TRY:
            try {
                execute(n.tryBlock, x);
            } catch (e if e === THROW && (j = n.catchClauses.length)) {
                e = x.result;
                x.result = undefined;
                for (i = 0; ; i++) {
                    if (i === j) {
                        x.result = e;
                        throw THROW;
                    }
                    t = n.catchClauses[i];
                    x.scope = {lo: {}, hi: {}, base: {}, parent: x.scope};
                    definitions.defineProperty(x.scopeSpace, t.varName, e, true);
                    x.scope.base[t.varName] = x.scopeSpace;
                    try {
                        if (t.guard && !getRawValue(execute(t.guard, x)))
                            continue;
                        execute(t.block, x);
                        break;
                    } finally {
                        x.scope = x.scope.parent;
                    }
                }
            } finally {
                if (n.finallyBlock)
                    execute(n.finallyBlock, x);
            }
            break;

          case THROW:
            x.result = getRawValue(execute(n.exception, x));
            throw THROW;

          case RETURN:
            // Check for returns with no return value
        	  if(n.value){
        		  // TODO MAY NEED TO ADD CODE TO CHECK PC on RETURN
        		  t= execute(n.value, x);
        		  x.result = getRawValue(t);
        	  }else{
        		  x.result = undefined;
        	  }
             
            throw RETURN;

          case WITH:
            w = execute(n.object, x);
            t = toObject(getRawValue(w), w, n.object);
            if (x.pc === H)
                x.scope = {hi: t, lo: {}, base: {}, parent: x.scope};
            else
                x.scope = {hi: {}, lo: t, base: {}, parent: x.scope};

            try {
                execute(n.body, x);
            } finally {
                x.scope = x.scope.parent;
            }
            break;

          case VAR:
          case CONST:
            c = n.children;
            for (i = 0, j = c.length; i < j; i++) {
                u = c[i].initializer;
                if (!u)
                    continue;
                t = c[i].name;
                for (s = x.scope; s; s = s.parent) {
                    if (hasDirectProperty(s.base, t))
                        break;
                }
                u = execute(u, x);
                if (n.type === CONST) {
                    definitions.defineProperty(s.scopeSpace, t, getRawValue(u),
                                               x.type !== EVAL_CODE, true);
                    s.scope.base[t] = s.scopeSpace;
                } else {
                    let cell, ck, cl;

                    // FIXME abstract out ASSIGN and use here
                    if (ck = getLabel(u, x.scope))
                        cell = new LabeledValue(getRawValue(u), ck);
                    else
                        cell = r;
                    s.scopeSpace[t] = cell;
                    s.scope.base[t] = s.scopeSpace;
                }
            }
            break;

          case DEBUGGER:
            throw "NYI: " + definitions.tokens[n.type];

          case SEMICOLON:
            if (n.expression)
                x.result = getRawValue(execute(n.expression, x));
            break;

          case LABELED:
            try {
                execute(n.statement, x);
            } catch (e if e === BREAK && x.target === n) {
            }
            break;

          case COMMA:
            c = n.children;
            for (i = 0, j = c.length; i < j; i++)
                r = getRawValue(execute(c[i], x));
            break;

          case ASSIGN:
            c = n.children;
            w = execute(c[0], x);
            t = n.assignOp;
            u = getRawValue(w);
            s = execute(c[1], x);
            r = getRawValue(s);
            k = getLabel(s, x.scope);

            // Slow-path: The label on the ref is not === the pc
            m = getLabel(w instanceof LabeledValue ? w.r : w, x.scope);
            if (slow = (m !== x.pc)) {
                let lhs = valuateLabel(joinLabel(x.pc, getLabel(w, x.scope)));
                let rhs = valuateLabel(joinLabel(m, getLabel(u, x.scope)));
                if (lhs > rhs)
                    throw new Error("flow violation: " + lhs + " </= " + rhs);
            }

            if (t) {
                switch (t) {
                  case BITWISE_OR:  r = u | r; break;
                  case BITWISE_XOR: r = u ^ r; break;
                  case BITWISE_AND: r = u & r; break;
                  case LSH:         r = u << r; break;
                  case RSH:         r = u >> r; break;
                  case URSH:        r = u >>> r; break;
                  case PLUS:        r = u + r; break;
                  case MINUS:       r = u - r; break;
                  case MUL:         r = u * r; break;
                  case DIV:         r = u / r; break;
                  case MOD:         r = u % r; break;
                }
            }

            if (slow) {
                let v = k ? new LabeledValue(r, k) : r;
                v = relabelValue(v, joinLabel(x.pc, getLabel(w, x.scope)), m);
                putValue(w, v, c[0]);
            } else {
                putValue(w, k ? new LabeledValue(r, k) : r, c[0]);
            }
            break;

          case HOOK:
            c = n.children;
            r = getRawValue(execute(c[0], x)) ? getRawValue(execute(c[1], x))
                                              : getRawValue(execute(c[2], x));
            break;

          case OR:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) || getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left || right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue  )
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case AND:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) && getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left && right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case BITWISE_OR:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) | getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left | right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case BITWISE_XOR:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) ^ getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left ^ right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            break;

          case BITWISE_AND:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) & getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left & right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case EQ:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) == getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left == right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case NE:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) != getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left != right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case STRICT_EQ:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) === getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left === right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case STRICT_NE:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) !== getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left !== right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case LT:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) < getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left < right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case LE:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) <= getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left <= right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case GE:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) >= getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left >= right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case GT:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) > getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left > right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            break;

          case IN:
            c = n.children;
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left in right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            // r = getRawValue(execute(c[0], x)) in getRawValue(execute(c[1],
			// x));
            break;

          case INSTANCEOF:
            c = n.children;
            t = getRawValue(execute(c[0], x));
            dLeft = getValueFromLabelValue(t);
            u = getRawValue(execute(c[1], x));
            if (isObject(u) && typeof u.__hasInstance__ === "function")
                r = u.__hasInstance__(dLeft);
            else
                r = dLeft instanceof u;
            if(t instanceof LabeledValue)
             r=relabelValue(r, t.k, x.pc);
            break;

          case LSH:
            c = n.children;
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left << right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            // r = getRawValue(execute(c[0], x)) << getRawValue(execute(c[1],
			// x));
            break;

          case RSH:
            c = n.children;
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left >> right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            // r = getRawValue(execute(c[0], x)) >> getRawValue(execute(c[1],
			// x));
            break;

          case URSH:
            c = n.children;
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left >>> right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            // r = getRawValue(execute(c[0], x)) >>> getRawValue(execute(c[1],
			// x));
            break;

          case PLUS:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) + getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left + right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case MINUS:
            c = n.children;
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left - right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            // r = getRawValue(execute(c[0], x)) - getRawValue(execute(c[1],
			// x));
            break;

          case MUL:
            c = n.children;
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left * right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            // r = getRawValue(execute(c[0], x)) * getRawValue(execute(c[1],
			// x));
            break;

          case DIV:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) / getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left / right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case MOD:
            c = n.children;
            // r = getRawValue(execute(c[0], x)) % getRawValue(execute(c[1],
			// x));
            dLeft = execute(c[0], x); 
            dRight = execute(c[1], x);
            func = liftOp(function(left, right) { return left % right; });
            r = func(getRawValue(dLeft),getRawValue(dRight));
            if(getRawValue(dLeft) instanceof LabeledValue || getRawValue(dRight) instanceof LabeledValue ) 
            r = relabelValue(r, joinLabel(getLabel(dRight, x.pc), getLabel(dLeft, x.pc), x.pc), x.pc); 
            
            break;

          case DELETE:
            t = execute(n.children[0], x);
            r = !(t instanceof Reference) || delete t.base[t.propertyName];
            break;

          case VOID:
            getRawValue(execute(n.children[0], x));
            break;

          case TYPEOF:
            t = getRawValue(execute(n.children[0], x));
            dLeft = getValueFromLabelValue(t);
            if (dLeft instanceof Reference)
            	dLeft = t.base ? dLeft.base[dLeft.propertyName] : undefined;
            r = typeof dLeft;
            if(t instanceof LabeledValue)
            r=relabelValue(r, t.k, x.pc);
                      
            break;

          case NOT:
        	  t  = getRawValue(execute(n.children[0], x));
        	  dLeft = getValueFromLabelValue(t);
        	  func = liftUnaryOp(function(left) { return !left; });
        	  r = func(dLeft);
        	  if(t instanceof LabeledValue)
        	  r=relabelValue(r, t.k, x.pc);
        	  
        	  
        	  // r = !getRawValue();
            break;

          case BITWISE_NOT:
        	  t  = getRawValue(execute(n.children[0], x));
        	  dLeft = getValueFromLabelValue(t);
        	  func = liftUnaryOp(function(left) { return ~left; });
        	  r = func(dLeft);
        	  if(t instanceof LabeledValue)
        	  r=relabelValue(r, t.k, x.pc);
            // r = ~getRawValue(execute(n.children[0], x));
            break;

          case UNARY_PLUS:
            // r = +getRawValue(execute(n.children[0], x));
        	  t  = getRawValue(execute(n.children[0], x));
        	  dLeft = getValueFromLabelValue(t);
        	  func = liftUnaryOp(function(left) { return +left; });
        	  r = func(dLeft);
        	  if(t instanceof LabeledValue)
        	  r=relabelValue(r, t.k, x.pc);
            break;

          case UNARY_MINUS:
            // r = -getRawValue(execute(n.children[0], x));
        	  t  = getRawValue(execute(n.children[0], x));
        	  dLeft = getValueFromLabelValue(t);
        	  func = liftUnaryOp(function(left) { return -left; });
        	  r = func(dLeft);
        	  if(t instanceof LabeledValue)
        	  r=relabelValue(r, t.k, x.pc);
            break;

          case LABEL:
            r = getRawValue(execute(n.expression, x));
            k = n.infolabel;
            break;
          
          case INCREMENT:
          case DECREMENT:
            t = execute(n.children[0], x);
            dExec = getRawValue(t);
            u = Number(getValueFromLabelValue(dExec));
            
            print(dExec);
            if (n.postfix){
                r = u;
                
                r=relabelValue(r, dExec.k, x.pc);
                	
                
            }
                	
            (n.type === INCREMENT) ? ++u : --u;
                if(dExec instanceof LabeledValue){
                	u=relabelValue(u, dExec.k, x.pc);
                	
                }
                putValue(t, u, n.children[0]);
                  
            if (!n.postfix)
                r = u;
            
           break;

          case DOT:
            c = n.children;
            w = execute(c[0], x);
            t = getRawValue(w);
            u = c[1].value;
            r = new Reference(toObject(t, w, c[0]), u, n);
            break;

          case INDEX:
            c = n.children;
            w = execute(c[0], x);
            t = getRawValue(w);
            u = getRawValue(execute(c[1], x));
            r = new Reference(toObject(t, w, c[0]), String(u), n);
            break;

          case LIST:
            // Curse ECMA for specifying that arguments is not an Array object!
            r = {};
            c = n.children;
            for (i = 0, j = c.length; i < j; i++) {
                u = getRawValue(execute(c[i], x));
                definitions.defineProperty(r, i, u, false, false, true);
            }
            definitions.defineProperty(r, "length", i, false, false, true);
            break;

          case CALL:
            c = n.children;
            w = execute(c[0], x);
            a = execute(c[1], x);
            f = getRawValue(w);
            if (isPrimitive(f) || typeof f.__call__ !== "function") {
                throw new TypeError(r + " is not callable", c[0].filename, c[0].lineno);
            }
            t = (w instanceof Reference) ? w.base : null;
            if (t instanceof Activation)
                t = null;
            r = f.__call__(t, a, x);
            break;

          case NEW:
          case NEW_WITH_ARGS:
            c = n.children;
            w = execute(c[0], x);
            f = getRawValue(w);
            if (n.type === NEW) {
                a = {};
                definitions.defineProperty(a, "length", 0, false, false, true);
            } else {
                a = execute(c[1], x);
            }
            if (isPrimitive(f) || typeof f.__construct__ !== "function") {
                throw new TypeError(w + " is not a constructor", c[0].filename, c[0].lineno);
            }
            r = f.__construct__(a, x);
            break;
            
          
          case ARRAY_INIT:
            r = [];
            c = n.children;
            for (i = 0, j = c.length; i < j; i++) {
                if (c[i])
                    r[i] = getRawValue(execute(c[i], x));
            }
            r.length = j;
            break;

          case OBJECT_INIT:
            r = {};
            c = n.children;
            for (i = 0, j = c.length; i < j; i++) {
                t = c[i];
                if (t.type === PROPERTY_INIT) {
                    let cell, ck;
                    let c2 = t.children;
                    u = execute(c2[i], x);
                    // FIXME not partitioned
                    r[c2[0].value] = getRawValue(u);
                } else {
                    f = newFunction(t, x);
                    u = (t.type === GETTER) ? '__defineGetter__'
                                            : '__defineSetter__';
                    r[u](t.name, thunk(f, x));
                }
            }
            break;

          case NULL:
            r = null;
            break;

          case THIS:
            r = x.thisObject;
            break;

          case TRUE:
            r = true;
            break;

          case FALSE:
            r = false;
            break;

          case IDENTIFIER:
            for (s = x.scope; s; s = s.parent) {
                if (n.value in s.base)
                    break;
            }
            r = new Reference(s && s.base[n.value], n.value, n);
            break;

          case NUMBER:
          case STRING:
          case REGEXP:
            r = n.value;
            break;

          case GROUP:
            r = execute(n.children[0], x);
            break;

          default:
            throw "PANIC: unknown operation " + n.type + ": " + uneval(n);
        }

        return k ? new LabeledValue(r, k) : r;
    }

    function Activation(f, a) {
        for (var i = 0, j = f.params.length; i < j; i++)
            definitions.defineProperty(this, f.params[i], a[i], true);
        definitions.defineProperty(this, "arguments", a, true);
    }

    // Null Activation.prototype's proto slot so that Object.prototype.* does
	// not
    // pollute the scope of heavyweight functions. Also delete its 'constructor'
    // property so that it doesn't pollute function scopes.

    Activation.prototype.__proto__ = null;
    delete Activation.prototype.constructor;

    function FunctionObject(node, scope) {
        this.node = node;
        this.scope = scope;
        definitions.defineProperty(this, "length", node.params.length, true, true, true);
        var proto = {};
        definitions.defineProperty(this, "prototype", proto, true);
        definitions.defineProperty(proto, "constructor", this, false, false, true);
    }

    function getPropertyDescriptor(obj, name) {
        while (obj) {
            if (({}).hasOwnProperty.call(obj, name))
                return Object.getOwnPropertyDescriptor(obj, name);
            obj = Object.getPrototypeOf(obj);
        }
    }

    function getOwnProperties(obj) {
        var map = {};
        for (var name in Object.getOwnPropertyNames(obj))
            map[name] = Object.getOwnPropertyDescriptor(obj, name);
        return map;
    }

    // Returns a new function wrapped with a Proxy.
    function newFunction(n, x) {
        var fobj = new FunctionObject(n, x.scope);
        var handler = definitions.makePassthruHandler(fobj);
        var p = Proxy.createFunction(handler,
                                     function() { return fobj.__call__(this, arguments, x); },
                                     function() { return fobj.__construct__(arguments, x); });
        return p;
    }

    var FOp = FunctionObject.prototype = {

        // Internal methods.
        __call__: function (t, a, x) {
            var x2 = new ExecutionContext(FUNCTION_CODE, x.pc);
            x2.thisObject = t || global;
            x2.caller = x;
            x2.callee = this;
            definitions.defineProperty(a, "callee", this, false, false, true);
            var f = this.node;
            if (x.pc === H) {
                x2.scope = {hi: new Activation(f, a), lo: {}, base: {},
                            parent: this.scope};
            } else {
                x2.scope = {hi: {}, lo: new Activation(f, a), base: {},
                            parent: this.scope};
            }

            try {
                x2.execute(f.body);
            } catch (e if e === RETURN) {
                return x2.result;
            }
            return undefined;
        },

        __construct__: function (a, x) {
            var o = new Object;
            var p = this.prototype;
            if (isObject(p))
                o.__proto__ = p;
            // else o.__proto__ defaulted to Object.prototype

            var v = this.__call__(o, a, x);
            if (isObject(v))
                return v;
            return o;
        },

        __hasInstance__: function (v) {
            if (isPrimitive(v))
                return false;
            var p = this.prototype;
            if (isPrimitive(p)) {
                throw new TypeError("'prototype' property is not an object",
                                    this.node.filename, this.node.lineno);
            }
            var o;
            while ((o = v.__proto__)) {
                if (o === p)
                    return true;
                v = o;
            }
            return false;
        },

        // Standard methods.
        toString: function () {
            return this.node.getSource();
        },

        apply: function (t, a) {
            // Curse ECMA again!
            if (typeof this.__call__ !== "function") {
                throw new TypeError("Function.prototype.apply called on" +
                                    " uncallable object");
            }

            if (t === undefined || t === null)
                t = global;
            else if (typeof t !== "object")
                t = toObject(t, t);

            if (a === undefined || a === null) {
                a = {};
                definitions.defineProperty(a, "length", 0, false, false, true);
            } else if (a instanceof Array) {
                var v = {};
                for (var i = 0, j = a.length; i < j; i++)
                    definitions.defineProperty(v, i, a[i], false, false, true);
                definitions.defineProperty(v, "length", i, false, false, true);
                a = v;
            } else if (!(a instanceof Object)) {
                // XXX check for a non-arguments object
                throw new TypeError("Second argument to Function.prototype.apply" +
                                    " must be an array or arguments object",
                                    this.node.filename, this.node.lineno);
            }

            return this.__call__(t, a, ExecutionContext.current);
        },

        call: function (t) {
            // Curse ECMA a third time!
            var a = Array.prototype.splice.call(arguments, 1);
            return this.apply(t, a);
        }
    };

    // Connect Function.prototype and Function.prototype.constructor in global.
    reflectClass('Function', FOp);

    // Help native and host-scripted functions be like FunctionObjects.
    var Fp = Function.prototype;
    var REp = RegExp.prototype;

    if (!('__call__' in Fp)) {
        definitions.defineProperty(Fp, "__call__",
                       function (t, a, x) {
                           // Curse ECMA yet again!
                           a = Array.prototype.splice.call(a, 0, a.length);
                           return this.apply(t, a);
                       }, true, true, true);
        definitions.defineProperty(REp, "__call__",
                       function (t, a, x) {
                           a = Array.prototype.splice.call(a, 0, a.length);
                           return this.exec.apply(this, a);
                       }, true, true, true);
        definitions.defineProperty(Fp, "__construct__",
                       function (a, x) {
                           a = Array.prototype.splice.call(a, 0, a.length);
                           switch (a.length) {
                             case 0:
                               return new this();
                             case 1:
                               return new this(a[0]);
                             case 2:
                               return new this(a[0], a[1]);
                             case 3:
                               return new this(a[0], a[1], a[2]);
                             default:
                               var argStr = "";
                               for (var i=0; i<a.length; i++) {
                                   argStr += 'a[' + i + '],';
                               }
                               return eval('new this(' + argStr.slice(0,-1) + ');');
                           }
                       }, true, true, true);

        // Since we use native functions such as Date along with host ones such
        // as global.eval, we want both to be considered instances of the native
        // Function constructor.
        definitions.defineProperty(Fp, "__hasInstance__",
                       function (v) {
                           return v instanceof Function || v instanceof global.Function;
                       }, true, true, true);
    }

    function thunk(f, x) {
        return function () { return f.__call__(this, arguments, x); };
    }

    function evaluate(s, f, l) {
        if (typeof s !== "string")
            return s;

        try {
            var x = new ExecutionContext(GLOBAL_CODE, L);
            x.execute(parser.parse(s, f, l));
            return x.result;
        } catch(e) {
            print(e);
            print("\nStack trace:");
            print(e.stack);
        }
    }

    // A read-eval-print-loop that roughly tracks the behavior of the js shell.
    function repl() {

        // Display a value similarly to the js shell.
        function display(x) {
            if (typeof x === "object") {
                // At the js shell, objects with no |toSource| don't print.
                if (x !== null && "toSource" in x) {
                    try {
                        print(x.toSource());
                    } catch (e) {
                    }
                } else {
                    print("null");
                }
            } else if (typeof x === "string") {
                print(uneval(x));
            } else if (typeof x !== "undefined") {
                // Since x must be primitive, String can't throw.
                print(String(x));
            }
        }

        // String conversion that never throws.
        function string(x) {
            try {
                return String(x);
            } catch (e) {
                return "unknown (can't convert to string)";
            }
        }

        var x = new ExecutionContext(GLOBAL_CODE, L);

        ExecutionContext.current = x;
        for (;;) {
            x.result = undefined;
            putstr("njs> ");
            var line = readline();
            // If readline receives EOF it returns null.
            if (line === null) {
                print("");
                break;
            }
            try {
                execute(parser.parse(line, "stdin", 1), x);
                display(x.result);
            } catch (e if e === THROW) {
                print("uncaught exception: " + string(x.result));
            } catch (e if e === END) {
                break;
            } catch (e if e instanceof SyntaxError) {
                print(e.toString());
            } catch (e) {
                print("internal Narcissus error");
                if (typeof e === "object" && e.stack) {
                    let st = String(e.stack).split(/\n/);
                    // beautify stack trace:
                    // - eliminate blank lines
                    // - sanitize confusing trace lines for getters and js -e
					// expressions
                    // - simplify source location reporting
                    // - indent
                    for (let i = 0; i < st.length; i++) {
                        let line = st[i].trim();
                        if (line) {
                            line = line.replace(/^(\(\))?@/, "<unknown>@");
                            line = line.replace(/@(.*\/|\\)?([^\/\\]+:[0-9]+)/, " at $2");
                            print("    in " + line);
                        }
                    }
                }
                throw e;
            }
        }
        ExecutionContext.current = null;
    }

    return {
        global: global,
        evaluate: evaluate,
        repl: repl
    };

}());
