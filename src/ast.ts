"use strict";

///<reference path='../quby.ts' />

/**
 * AST
 *
 * Objects for declaring the abstract syntax tree are defined
 * here. A new function is here for representing every aspect
 * of the possible source code that can be parsed.
 */
/*
 * Functions, classes, variables and other items in Quby have both a 'name'
 * and a 'callName'. This describes some of their differences.
 *
 * = Names =
 * These are for display purposes. However names should be be considered to
 * be unique, and so entirely different names can refer to the same thing.
 *
 * For example 'object' and 'Object' are different names but can potentially
 * refer to the same thing. However what they refer to also depends on context,
 * for example one might be a function called object and the other might be
 * the Object class. In that context they refer to entirely different things.
 *
 * In short, Names are used for displaying information and should never be
 * used for comparison.
 *
 * = CallNames =
 * callNames however are unique. They are always in lower case, include no
 * spaces and include their context in their formatting. This means it is
 * safe to directly compare callNames (i.e. 'callName1 == callName2').
 * It is also safe to use them in defining JSON object properties.
 *
 * The format functions in quby.runtime should be used for creating callNames
 * from names. They are also designed to ensure that a callName of one context
 * cannot refer to a callName of a different context.
 *
 * This is achieved by appending context unique identifiers to the beginning
 * of the callName stating it's context (function, variable, class, etc).
 *
 * They are 'context unique' because one context prefix does not clash with
 * another contexts prefix.
 */
module quby.ast {
    export interface ISyntax {
        offset: parse.Symbol;

        validate: (v: quby.core.Validator) => void;
        print: (p: quby.core.Printer) => void;
        getOffset: () => parse.Symbol;

        /**
         * A 'JS Literal' is any native JS Syntax.
         * For exmaple, JS variables, or creating
         * classes in a JS way.
         */
        isJSLiteral: () => bool;
        setJSLiteral: (isLit: bool) => void;
    }

    export interface IExpr extends ISyntax {
        printAsCondition: (p: quby.core.Printer) => void;
    }

    export interface INamedExpr extends IExpr {
        getName(): string;
        getCallName(): string;
    }

    export interface IFunctionMeta extends ISyntax {
        isConstructor(): bool;
        isFunction(): bool;
        isMethod(): bool;

        getCallName(): string;
        getName(): string;

        getNumParameters(): number;
    }

    export interface IStatements extends ISyntax {
        length: number;
    }

    export interface IClassDeclaration extends ISyntax {
        getHeader(): ClassHeader;
        setHeader(header: ClassHeader);

        getName(): string;
        getCallName(): string;
        getSuperCallName(): string;

        getStatements(): SyntaxList;

        isExtensionClass(): bool;
    }

    export interface IAssignable extends IExpr {
        setAssignment(v?:quby.core.Validator, parent?:Assignment): void;
    }

    export interface IPrecedence {
        getPrecedence: () => number;

        rebalance(): IExpr;
        onRebalance(): IExpr;
        performBalanceSwap(newLeft: BalancingExpr, precedence: number): IExpr ;
    }

    /**
     * There are times when it's much easier to just pass
     * an empty, silently-do-nothing, object into out
     * abstract syntax tree.
     *
     * That is what this is for, it will silently do nothing
     * on both validate and print.
     *
     * Do not extend this! Extend the Syntax one instead.
     */
    class EmptyStub implements ISyntax {
        public offset: parse.Symbol;

        private isJSLiteralFlag: bool;

        constructor (offset?: parse.Symbol = null) {
            this.offset = offset;
            this.isJSLiteralFlag = false;
        }

        validate(v: quby.core.Validator) { }
        print(p: quby.core.Printer) { }
        getOffset() {
            return this.offset;
        }

        isJSLiteral() {
            return this.isJSLiteralFlag;
        }

        setJSLiteral(isLit: bool) {
            this.isJSLiteralFlag = isLit;
        }
    }

    /*
     * These functions do the actual modifications to the class.
     * They alter the class structure, inserting new nodes to add more functionality.
     *
     * They are run as methods of the FunctionGenerator prototype.
     *
     * Add more here to have more class modifiers.
     */
    var functionGeneratorFactories = {
        // prefix hard coded into these functions
        "get": function (fun:FunctionCall, param:INamedExpr) {
            return new FunctionReadGenerator(fun, 'get', param);
        },
        "set": function (fun:FunctionCall, param:INamedExpr) {
            return new FunctionWriteGenerator(fun, 'set', param);
        },
        "getset": function (fun:FunctionCall, param:INamedExpr) {
            return new FunctionReadWriteGenerator(fun, 'get', 'set', param);
        },

        "read": function (fun:FunctionCall, param:INamedExpr) {
            return new FunctionReadGenerator(fun, '', param);
        },
        "write": function (fun:FunctionCall, param:INamedExpr) {
            return new FunctionWriteGenerator(fun, '', param);
        },
        "attr": function (fun:FunctionCall, param:INamedExpr) {
            return new FunctionReadWriteGenerator(fun, '', '', param);
        }
    };

    /**
     * Class Modifiers are psudo-functions you can call within a class.
     * For example 'get x' to generate the method 'getX()'.
     * 
     * @return A syntax object representing whatever this will generate.
     */
    /*
     * Lookup the function generator, and then expand the given function into multiple function generators.
     * So get x, y, z becomes three 'get' generators; getX, getY and getZ.
     */
    var getFunctionGenerator = function(v:quby.core.Validator, fun:FunctionCall) : ISyntax {
        var name = fun.getName().toLowerCase();
        var modifierFactory = <(fun:FunctionCall, param:INamedExpr) => FunctionGenerator >functionGeneratorFactories[name];

        if (modifierFactory) {
            var params = fun.getParameters();

            // this is to avoid building a FactoryGenerators middle-man collection
            if (params.length === 1) {
                return modifierFactory( fun, <INamedExpr> params.getStmts()[0] );
            } else {
                var generators: ISyntax[] = [];

                // sort the good parameters from the bad
                // they must all be Varaibles
                params.each((param) => {
                    generators.push(modifierFactory(fun, <INamedExpr> param));
                });

                if (generators.length > 0) {
                    return new TransparentList(generators);
                } else {
                    return new EmptyStub();
                }
            }
        } else {
            return null;
        }
    };

    /*
     * ### PUBLIC ###
     */

    export class Syntax implements ISyntax {
        public offset: parse.Symbol;
        private isJSLiteralFlag = false;

        constructor (offset?:parse.Symbol = null) {
            this.offset = offset;
            this.isJSLiteralFlag = false;
        }

        print(printer: quby.core.Printer) {
            quby.runtime.error("Internal", "Error, print has not been overridden");
        }

        /**
         * Helper print function, for printing values in an if, while or loop condition.
         * When called, this will store the result in a temporary variable, and test against
         * Quby's idea of false ('false' and 'null').
         */
        printAsCondition(p: quby.core.Printer) {
            p.appendPre('var ', quby.runtime.TEMP_VARIABLE, ';');

            p.append('((', quby.runtime.TEMP_VARIABLE, '=');
            this.print(p);
            p.append(') !== null && ', quby.runtime.TEMP_VARIABLE, ' !== false)');

            // needed to prevent memory leaks
            p.appendPost('delete ', quby.runtime.TEMP_VARIABLE, ';');
        }

        validate(v: quby.core.Validator) {
            quby.runtime.error("Internal", "Error, validate has not been overridden");
        }

        /**
         * By 'offset', it means the offset within the source
         * file, that this comes from.
         *  
         * This allows an offset to be set; either the first
         * offset this has seen, or an entirely new one to replace
         * an existing offset.
         * 
         * @param offset The Symbol for use for displaying the file offset information.
         */ 
        setOffset(offset: parse.Symbol) {
            this.offset = offset;
        }

        /**
         * @return Null if no offset, and otherwise an offset object. 
         */
        getOffset() : parse.Symbol {
            return this.offset;
        }

        isJSLiteral(): bool {
            return this.isJSLiteralFlag;
        }

        setJSLiteral(isLit: bool) {
            this.isJSLiteralFlag = isLit;
        }
    }

    /**
     * The most basic type of statement list.
     * Just wraps an array of statements,
     * and passes the calls to validate and print on to them.
     */
    export class TransparentList implements ISyntax {
        public offset: parse.Symbol;

        private stmts: ISyntax[];
        private isJSLiteralFlag: bool;

        constructor (stmts: ISyntax[]) {
            this.stmts = stmts;
            this.offset = null;

            for (var i = 0; i < stmts.length; i++) {
                var off = stmts[i].getOffset();

                if (off !== null) {
                    this.offset = off;
                    break;
                }
            }

            this.isJSLiteralFlag = false;
        }

        isJSLiteral(): bool {
            return this.isJSLiteralFlag;
        }

        setJSLiteral(isLit: bool) {
            this.isJSLiteralFlag = isLit;
        }

        getStmts(): ISyntax[] {
            return this.stmts;
        }

        getOffset() {
            return this.offset;
        }

        validate(v: quby.core.Validator) {
            var stmts = this.stmts;

            for (var i = 0; i < stmts.length; i++) {
                stmts[i].validate(v);
            }
        }

        print(p: quby.core.Printer) {
            var stmts = this.stmts;

            for (var i = 0; i < stmts.length; i++) {
                stmts[i].print(p);
                p.endStatement();
            }
        }
    }

    export class SyntaxList implements IStatements {
        public length: number;
        public offset: parse.Symbol;

        private seperator: string;
        private appendToLast: bool;
        private stmts: ISyntax[];

        private isJSLiteralFlag: bool;

        constructor (strSeperator: string, appendToLast: bool, stmts?: ISyntax[] = []) {
            this.stmts = stmts;
            this.seperator = strSeperator;
            this.appendToLast = appendToLast;
            this.offset = null;
            this.length = stmts.length;

            for (var i = 0; i < stmts.length; i++) {
                var offset = stmts[i].getOffset();

                if (offset) {
                    this.offset = offset;
                    break;
                }
            }
        }

        isJSLiteral() {
            return this.isJSLiteralFlag;
        }

        setJSLiteral(isLit: bool) {
            this.isJSLiteralFlag = isLit;
        }

        setSeperator(seperator: string) {
            this.seperator = seperator;
        }

        add(stmt: ISyntax) {
            this.ensureOffset(stmt);
            this.stmts.push(stmt);
            this.length++;

            return this;
        }
        unshift(stmt: ISyntax) {
            this.ensureOffset(stmt);
            this.stmts.unshift(stmt);
            this.length++;

            return this;
        }
        ensureOffset(stmt: ISyntax) {
            if (this.offset === null) {
                this.offset = stmt.offset;
            }
        }
        print(p: quby.core.Printer) {
            var length = this.stmts.length;

            for (var i = 0; i < length; i++) {
                this.stmts[i].print(p);

                if (this.appendToLast || i < length - 1) {
                    p.append(this.seperator);
                }
            }
        }

        setArr(arr: ISyntax[]): SyntaxList {
            this.stmts = arr;
            this.length = arr.length;

            if (arr.length > 0) {
                this.ensureOffset(arr[0]);
            }

            return this;
        }

        validate(v: quby.core.Validator) {
            for (var i = 0; i < this.stmts.length; i++) {
                this.stmts[i].validate(v);
            }
        }

        each(fun: (stmt: ISyntax) => void ) {
            for (var i = 0; i < this.stmts.length; i++) {
                fun(this.stmts[i]);
            }
        }

        getStmts() {
            return this.stmts;
        }

        getOffset() {
            return this.offset;
        }
    }

    export class Statements extends SyntaxList {
        constructor (stmtsArray?: ISyntax[]) {
            super('', false, stmtsArray);
        }

        print(p: quby.core.Printer) {
            p.printArray(this.getStmts());
        }
    }

    export class Parameters extends SyntaxList {
        private blockParam: ParameterBlockVariable;
        private errorParam: ParameterBlockVariable;
        private blockParamPosition: number;

        constructor ( params?: ISyntax[] ) {
            super(',', false, params);

            this.blockParam = null;
            this.errorParam = null;
            this.blockParamPosition = -1;
        }

        /**
         * Adds to the ends of the parameters.
         */
        /*
         * Override the add so that block parameters are stored seperately from
         * other parameters.
         */
        add(param: IAssignable) {
            if (param instanceof ParameterBlockVariable) {
                this.setBlockParam(<ParameterBlockVariable>param);
            } else {
                SyntaxList.call(this, param);
            }

            return this;
        }

        /**
         * Adds to the beginning of the parameters.
         */
        addFirst(param: IAssignable) {
            if (param instanceof ParameterBlockVariable) {
                this.setBlockParam(<ParameterBlockVariable>param);
            } else {
                SyntaxList.call(this, param);

                this.getStmts().pop();
                this.getStmts().unshift(param);
            }

            return this;
        }

        setArr(params: IAssignable[]) {
            for (var i = 0; i < params.length; i++) {
                if (params[i] instanceof ParameterBlockVariable) {
                    this.setBlockParam( <ParameterBlockVariable>params[i] );
                    params.splice(i, 1);
                }
            }

            return super.setArr(params);
        }

        /**
         * Sets the block parameter for this set of parameters.
         * This can only be set once, and no more parameters should be set after
         * this has been called.
         *
         * @param blockParam A block parameter for this set of parameters.
         */
        setBlockParam(blockParam: ParameterBlockVariable) {
            // You can only have 1 block param.
            // If a second is given, store it later for a validation error.
            if (this.blockParam !== null) {
                this.errorParam = blockParam;
            } else {
                this.blockParam = blockParam;
                // Record the position so we can check if it's the last parameter or not.
                this.blockParamPosition = this.getStmts().length;
            }
        }

        getBlockParam(): ParameterBlockVariable {
            return this.blockParam;
        }

        validate(v: quby.core.Validator) {
            if (this.blockParam != null) {
                if (this.errorParam != null) {
                    v.parseError(this.errorParam.offset, "Only one block parameter is allowed.");
                } else if (this.blockParamPosition < this.getStmts().length) {
                    v.parseError(this.blockParam.offset, "Block parameter must be the last parameter.");
                }
            }

            super.validate(v);

            if (this.blockParam != null) {
                this.blockParam.validate(v);
            }
        }
    }

    export class Mappings extends SyntaxList {
        constructor (mappings?: ISyntax[]) {
            super(',', false, mappings);
        }
    }

    /**
     * A common building block to create a list of statements,
     * which starts or ends with a conditional test.
     * 
     * For example an if statement, while loop, until loop,
     * while until, and so on.
     */
    export class StmtBlock extends Syntax {
        private condition: IExpr;
        private stmts: IStatements;

        constructor (condition: IExpr, stmts: IStatements) {
            if (condition !== null) {
                super(condition.offset);
            } else {
                super(stmts.offset);
            }

            this.condition = condition;
            this.stmts = stmts;
        }

        validate(v: quby.core.Validator) {
            if (this.condition !== null) {
                this.condition.validate(v);
            }

            this.stmts.validate(v);
        }

        getCondition(): IExpr {
            return this.condition;
        }
        getStmts() {
            return this.stmts;
        }

        printBlockWrap(p: quby.core.Printer, preCondition: string, postCondition: string, postBlock: string) {
            p.append(preCondition);
            this.getCondition().printAsCondition(p)
            p.append(postCondition).flush();
            this.getStmts().print(p);
            p.append(postBlock);
        }
    }

    export class IfStmt extends Syntax {
        private ifStmts: Statements;
        private elseIfStmts: Statements;
        private elseStmt: Statements;

        constructor (ifs: Statements, elseIfs: Statements, elseBlock: Statements) {
            super(ifs.getOffset());

            this.ifStmts = ifs;
            this.elseIfStmts = elseIfs;
            this.elseStmt = elseBlock;
        }

        validate(v: quby.core.Validator) {
            this.ifStmts.validate(v);

            if (this.elseIfStmts !== null) {
                this.elseIfStmts.validate(v);
            }

            if (this.elseStmt !== null) {
                this.elseStmt.validate(v);
            }
        }

        print(p: quby.core.Printer) {
            this.ifStmts.print(p);

            if (this.elseIfStmts !== null) {
                p.append('else ');
                this.elseIfStmts.print(p);
            }

            if (this.elseStmt !== null) {
                p.append('else{');
                this.elseStmt.print(p);
                p.append('}');
            }
        }
    }

    export class IfElseIfs extends SyntaxList {
        constructor (elseIfs?:IfBlock[]) {
            super('else ', false, elseIfs);
        }
    }

    export class IfBlock extends StmtBlock {
        constructor (condition: IExpr, stmts: Statements) {
            super(condition, stmts);
        }

        print(p: quby.core.Printer) {
            super.printBlockWrap(p, 'if(', '){', '}');
        }
    }

    export class WhenClause extends Syntax {
        private exprs: Parameters;
        private stmts: IStatements;

        constructor(exprs: Parameters, stmts: IStatements) {
            super( exprs.getOffset() );

            this.exprs = exprs;
            this.stmts = stmts;
        }

        validate(v: quby.core.Validator) {
            if (this.exprs.length === 0) {
                v.parseError(this.getOffset(), "no conditions provided for when clause");
            } else {
                this.exprs.validate(v);
                this.stmts.validate(v);
            }
        }

        printClause(p: quby.core.Printer, tempVar: string, isFirst: bool) {
            if (!isFirst) {
                p.append(' else');
            }
            p.append(' if (');

            var startExpr = '(' + tempVar + ' === ';
            p.append(startExpr);
            this.exprs.setSeperator(') || ' + startExpr);
            this.exprs.print(p);
            p.append(')');

            p.append(')'); // close whole if condition

            p.append('{');
            this.stmts.print(p);
            p.append('}');
        }
    }

    /**
     * The classic switch-case statement, or in Ruby, case-when.
     * Really it's just a big if-statement underneath, as JS's
     * standard switch-case is much slower than if.
     * 
       Example Code:

            case n
                when 1, f(), 3 then doSomething()
                when abc; doThat()
                when 5
                    doSomethingElse()
                else
                    blah()
            end

     */
    export class CaseWhen extends Syntax {
        private condition: IExpr;
        private whenClauses: WhenClause[];
        private elseClause: IStatements;

        constructor(caseSymbol:parse.Symbol, expr: IExpr, whens:WhenClause[], elseClause:IStatements) {
            super(caseSymbol);

            this.condition = expr;
            this.whenClauses = whens;
            this.elseClause = elseClause;
        }

        validate(v: quby.core.Validator) {
            var whenClauses = this.whenClauses;

            if (this.condition === null) {
                if (whenClauses.length === 0) {
                    v.parseError(this.getOffset(), "case-when clause is entirely empty");
                } else {
                    v.parseError(this.getOffset(), "no expression provided for case");
                }

                return;
            } else if (whenClauses.length === 0) {
                v.parseError(this.getOffset(), "no when clauses provided for case");

                return;
            }

            this.condition.validate(v);

            for (var i = 0; i < whenClauses.length; i++) {
                whenClauses[i].validate(v);
            }

            if (this.elseClause !== null) {
                this.elseClause.validate(v);
            }
        }

        print(p: quby.core.Printer) {
            var temp = p.getTempVariable();

            p.append('var ', temp, ' = ');
            this.condition.print(p);
            p.endStatement();

            var whenClauses = this.whenClauses;
            for (var i = 0; i < whenClauses.length; i++) {
                whenClauses[i].printClause(p, temp, i === 0);
                
            }

            if (this.elseClause !== null) {
                p.append(' else {');
                this.elseClause.print(p);
                p.append('}');
            }
        }
    }

    export class WhileLoop extends StmtBlock {
        constructor (condition: IExpr, stmts: Statements) {
            super(condition, stmts);
        }

        print(p: quby.core.Printer) {
            this.printBlockWrap(p, 'while(', '){', '}');
        }
    }

    export class UntilLoop extends StmtBlock {
        constructor (condition: IExpr, stmts: Statements) {
            super(condition, stmts);
        }

        print(p: quby.core.Printer) {
            this.printBlockWrap(p, 'while(!(', ')){', '}');
        }
    }

    export class LoopWhile extends StmtBlock {
        constructor (condition: IExpr, stmts: Statements) {
            super(condition, stmts);
        }

        print(p: quby.core.Printer) {
            // flush isn't needed here,
            // because statements on the first line will always take place
            p.append('do{');
            this.getStmts().print(p);
            p.append('}while(');
            this.getCondition().printAsCondition(p);
            p.append(')');
        }
    }

    export class LoopUntil extends StmtBlock {
        constructor (condition: IExpr, stmts: Statements) {
            super(condition, stmts);
        }

        print(p: quby.core.Printer) {
            p.append('do{');
            this.getStmts().print(p);
            p.append('}while(!(');
            this.getCondition().printAsCondition(p);
            p.append('))');
        }
    }

    /**
     * This describes the signature of a class. This includes information
     * such as this classes identifier and it's super class identifier.
     */
    export class ClassHeader extends Syntax {
        private classId: parse.Symbol;
        private extendId: parse.Symbol;
        private match: string;

        private extendsCallName: string;
        private extendsName: string;

        constructor (identifier: parse.Symbol, extendsId: parse.Symbol) {
            super(identifier);

            if (extendsId == null) {
                this.extendsCallName = quby.runtime.ROOT_CLASS_CALL_NAME;
                this.extendsName = quby.runtime.ROOT_CLASS_NAME;
            } else {
                this.extendsCallName = quby.runtime.formatClass(extendsId.match);
                this.extendsName = extendsId.match;
            }

            this.classId = identifier;
            this.extendId = extendsId;
            this.match = identifier.match;
        }

        getName() {
            return this.match;
        }

        /**
         * Returns the call name for the super class to this class header.
         */
        getSuperCallName() {
            return this.extendsCallName;
        }

        /**
         * Returns the name of the super class to this class header.
         */
        getSuperName() {
            return this.extendsName;
        }

        validate(v: quby.core.Validator) {
            var name = this.classId.getLower();

            if (this.hasSuper()) {
                var extendName = this.extendId.getLower();
                var extendStr = this.extendId.match;

                if (name == extendName) {
                    v.parseError(this.offset, "Class '" + this.match + "' is extending itself.");
                } else if (quby.runtime.isCoreClass(name)) {
                    v.parseError(this.offset, "Core class '" + this.match + "' cannot extend alternate class '" + extendStr + "'.");
                } else if (quby.runtime.isCoreClass(extendName)) {
                    v.parseError(this.offset, "Class '" + this.match + "' cannot extend core class '" + extendStr + "'.");
                }
            }
        }

        /**
         * Returns true if there is a _declared_ super class.
         *
         * Note that if this returns false then 'getSuperCallName' and
         * 'getSuperName' will return the name of the root class (i.e.
         * Object).
         */
        hasSuper() {
            return this.extendId !== null;
        }
    }

    /**
     * TODO
     */
    export class ModuleDeclaration extends Syntax {
        constructor (symName, statements) {
            super(symName);
        }

        print(p: quby.core.Printer) {
            // TODO
        }
        validate(v: quby.core.Validator) {
            // TODO
        }
    }

    export class NamedSyntax extends Syntax {
        private name: string;
        private callName: string;

        constructor(offset: parse.Symbol, name:string, callName:string) {
            super(offset);

            this.name = name;
            this.callName = callName;
        }

        getName(): string {
            return this.name;
        }

        setName(name: string) {
            this.name = name;
        }

        getCallName(): string {
            return this.callName;
        }

        setCallName(name: string) {
            this.callName = name;
        }
    }

    export class ClassDeclaration extends NamedSyntax implements IClassDeclaration {
        private classValidator: quby.core.ClassValidator;

        private header: ClassHeader;
        private statements: Statements;

        constructor (classHeader: ClassHeader, statements: Statements) {
            /*
             * Extension Class
             *
             * A real JS prototype, or existing type, which we are adding stuff
             * to.
             */
            if (quby.runtime.isCoreClass(classHeader.getName().toLowerCase())) {
                return new ExtensionClassDeclaration(classHeader, statements);
                /*
                 * Quby class
                 *
                 * Entirely user declared and created.
                 */
            } else {
                var name = classHeader.getName();

                super(
                        classHeader.offset,
                        name,
                        quby.runtime.formatClass( name )
                )

                this.header = classHeader;
                this.statements = statements;

                this.classValidator = null;
            }
        }

        getStatements() {
            return this.statements;
        }

        isExtensionClass() {
            return false;
        }

        getHeader() {
            return this.header;
        }

        setHeader(header: ClassHeader) {
            this.header = header;
        }

        validate(v: quby.core.Validator) {
            var name = this.getName();

            v.ensureOutFun(this, "Class '" + name + "' defined within a function, this is not allowed.");
            v.ensureOutBlock(this, "Class '" + name + "' defined within a block, this is not allowed.");

            // validator stored for printing later (validation check made inside)
            this.classValidator = v.setClass(this);
            this.header.validate(v);

            if (this.statements !== null) {
                this.statements.validate(v);
            }

            v.unsetClass();
        }

        print(p: quby.core.Printer) {
            return this.classValidator.printOnce(p);
        }

        /**
         * This returns it's parents callName, unless this does not have
         * a parent class (such as if this is the root class).
         *
         * Then it will return null.
         *
         * @return The callName for the parent class of this class.
         */
        getSuperCallName() {
            var superCallName = this.header.getSuperCallName();

            if (superCallName === this.getCallName()) {
                return null;
            } else {
                return superCallName;
            }
        }
    }

    /**
     * Extension Classes are ones that extend an existing prototype.
     * For example Number, String or Boolean.
     *
     * This also includes the extra Quby prototypes such as Array (really QubyArray)
     * and Hash (which is really a QubyHash).
     */
    export class ExtensionClassDeclaration extends NamedSyntax implements IClassDeclaration {
        private header: ClassHeader;
        private statements: Statements;

        constructor (classHeader: ClassHeader, statements: Statements) {
            var name = classHeader.getName();

            super(classHeader.offset, name, quby.runtime.formatClass(name) );

            this.header = classHeader;
            this.statements = statements;
        }

        getStatements() {
            return this.statements;
        }

        isExtensionClass() {
            return true;
        }

        getHeader() {
            return this.header;
        }

        setHeader(header: ClassHeader) {
            this.header = header;
        }

        print(p: quby.core.Printer) {
            p.setCodeMode(false);

            if (this.statements !== null) {
                p.appendExtensionClassStmts(this.getName(), this.statements.getStmts());
            }

            p.setCodeMode(true);
        }

        validate(v: quby.core.Validator) {
            v.ensureOutClass(this, "Classes cannot be defined within another class.");

            v.setClass(this);
            this.header.validate(v);

            if (this.statements !== null) {
                this.statements.validate(v);
            }

            v.unsetClass();
        }

        /*
         * The parent class of all extension classes is the root class,
         * always.
         */
        getSuperCallName() {
            return quby.runtime.ROOT_CLASS_CALL_NAME;
        }
    }

    /**
     * Incomplete!
     * 
     * This is for 'Foo.class' identifiers.
     */
    export class ClassIdentifier extends Syntax {
        constructor (sym: parse.Symbol) {
            super(sym);
        }

        validate(v: quby.core.Validator) {
            // todo, look up this class!
        }
        print(p: quby.core.Printer) {
            // todo print out a '_class_function' or whatever is needed for the check
        }
    }

    /**
     * Defines a function or method declaration.
     */
    export class FunctionDeclaration extends NamedSyntax implements IFunctionMeta {
        static FUNCTION = 0;
        static METHOD = 1;
        static CONSTRUCTOR = 2;

        private type: number;

        private parameters: Parameters;

        private blockParam: ParameterBlockVariable;

        private stmtBody: Statements;

        private autoReturn: bool;

        /**
         * These are the variables initialized at the start
         * of a function call, to ensure they are not undefined.
         */
        private preVariables: Variable[];

        constructor(symName: parse.Symbol, parameters: Parameters, stmtBody: Statements) {
            super(symName, symName.match, '');

            this.type = FunctionDeclaration.FUNCTION;

            this.parameters = parameters;

            if (parameters !== null) {
                this.blockParam = parameters.getBlockParam();
                this.setCallName( quby.runtime.formatFun(symName.match, parameters.length) );
            } else {
                this.blockParam = null;
                this.setCallName( quby.runtime.formatFun(symName.match, 0) );
            }

            this.stmtBody = stmtBody;

            this.preVariables = [];

            this.autoReturn = false;
        }

        /**
         * When true, the last statement in a function or method
         * will automatically return it's value.
         */
        markAutoReturn() {
            this.autoReturn = true;
        }

        hasParameters() {
            return this.parameters !== null && this.parameters.length > 0;
        }

        getParameters() {
            return this.parameters;
        }

        getNumParameters() {
            return (this.parameters !== null) ?
                    this.parameters.length :
                    0;
        }

        getStatements() {
            return this.stmtBody;
        }

        isMethod() {
            return this.type !== FunctionDeclaration.METHOD;
        }

        isConstructor() {
            return this.type === FunctionDeclaration.CONSTRUCTOR;
        }

        isFunction() {
            return this.type === FunctionDeclaration.FUNCTION;
        }

        setType(type: number) {
            this.type = type;
        }

        addPreVariable(variable: quby.ast.Variable) {
            this.preVariables.push(variable);
        }

        validate(v: quby.core.Validator) {
            if (this.isFunction() && v.isInsideClass()) {
                this.setType(FunctionDeclaration.METHOD);
            }

            var isOutFun = true;

            if (v.isInsideFun()) {
                var otherFun = v.getCurrentFun();
                var strOtherType = (otherFun.isMethod() ? "method" : "function");

                v.parseError(this.offset, "Function '" + this.getName() + "' is defined within " + strOtherType + " '" + otherFun.getName() + "', this is not allowed.");
                isOutFun = false;
            } else {
                var strType = (this.isMethod() ? "Method" : "Function");

                v.ensureOutBlock(this, strType + " '" + this.getName() + "' is within a block, this is not allowed.");
            }

            if (isOutFun) {
                v.defineFun(this);
                v.pushFunScope(this);
            }

            v.setParameters(true, true);
            if (this.parameters !== null) {
                this.parameters.validate(v);
            }
            v.setParameters(false, false);

            if (this.stmtBody !== null) {
                this.stmtBody.validate(v);
            }

            if (isOutFun) {
                v.popScope();
            }
        }

        print(p: quby.core.Printer) {
            if (!this.isMethod()) {
                p.setCodeMode(false);
            }

            if (this.isMethod() && !this.isConstructor()) {
                p.append(this.getCallName(), '=function');
            } else {
                p.append('function ', this.getCallName());
            }

            this.printParameters(p);
            this.printBody(p);

            if (!this.isMethod()) {
                p.setCodeMode(true);
            }
        }

        printParameters(p: quby.core.Printer) {
            p.append('(');

            if (this.getNumParameters() > 0) {
                this.parameters.print(p);
                p.append(',');
            }

            p.append(quby.runtime.BLOCK_VARIABLE, ')');
        }

        printBody(p: quby.core.Printer) {
            p.append('{');

            this.printPreVars(p);
            p.flush();

            if (this.stmtBody !== null) {
                this.stmtBody.print(p);
            }

            // all functions must guarantee they return something...
            p.append('return null;', '}');
        }

        printPreVars(p: quby.core.Printer) {
            /*
             * Either pre-print all local vars + the block var,
             * or print just the block var.
             */
            if (this.preVariables.length > 0) {
                p.append('var ');

                for (var i = 0; i < this.preVariables.length; i++) {
                    if (i > 0) {
                        p.append(',');
                    }

                    var variable = this.preVariables[i];
                    p.append( variable.getCallName(), '=null' );
                }

                if (this.blockParam != null) {
                    p.append(',');
                    this.blockParam.print(p);
                    p.append('=', quby.runtime.BLOCK_VARIABLE, ';');
                }

                p.endStatement();
            } else if (this.blockParam != null) {
                p.append('var ');
                this.blockParam.print(p);
                p.append('=', quby.runtime.BLOCK_VARIABLE, ';');
            }
        }
    }

    /**
     * Defines a constructor for a class.
     */
    export class Constructor extends FunctionDeclaration {
        private className: string;
        private klass: ClassDeclaration;
        private isExtensionClass: bool;

        constructor (sym: parse.Symbol, parameters: Parameters, stmtBody: Statements) {
            super(sym, parameters, stmtBody);

            this.className = '';
            this.klass = null;
            this.isExtensionClass = false;

            this.setType(FunctionDeclaration.CONSTRUCTOR);
        }

        setClass(klass) {
            this.klass = klass;

            this.setCallName( quby.runtime.formatNew(klass.name, this.getNumParameters()) );

            this.className = klass.callName;
        }

        validate(v: quby.core.Validator) {
            if (v.ensureInClass(this, "Constructors must be defined within a class.")) {
                this.setClass( v.getCurrentClass().getClass() );

                this.isExtensionClass = v.isInsideExtensionClass();
                if (this.isExtensionClass) {
                    v.ensureAdminMode(this, "Cannot add constructor to core class: '" + v.getCurrentClass().getClass().getName() + "'");
                }

                v.setInConstructor(true);
                super.validate(v);
                v.setInConstructor(false);
            }
        }

        printParameters(p: quby.core.Printer) {
            p.append('(');

            if (!this.isExtensionClass) {
                p.append(quby.runtime.THIS_VARIABLE, ',');
            }

            if ( this.hasParameters() ) {
                this.getParameters().print(p);
                p.append(',');
            }

            p.append(quby.runtime.BLOCK_VARIABLE, ')');
        }

        printBody(p: quby.core.Printer) {
            p.append('{');

            this.printPreVars(p);
            p.endStatement();

            var stmts = this.getStatements();
            if (stmts !== null) {
                stmts.print(p);
            }

            if (!this.isExtensionClass) {
                p.append('return ', quby.runtime.THIS_VARIABLE, ';');
            }

            p.append('}');
        }
    }

    export class AdminMethod extends FunctionDeclaration {
        private callName: string;

        constructor (name: parse.Symbol, parameters: Parameters, stmtBody: Statements) {
            super(name, parameters, stmtBody);

            this.setCallName(name.match);
        }

        validate(v: quby.core.Validator) {
            v.ensureAdminMode(this, "Admin (or hash) methods cannot be defined without admin rights.");

            if (v.ensureInClass(this, "Admin methods can only be defined within a class.")) {
                super.validate(v);
            }
        }
    }

    /**
     * @param offset The source code offset for this Expr.
     * @param isResultBool An optimization flag. Pass in true if the result of this Expression will always be a 'true' or 'false'. Optional, and defaults to false.
     */
    export class Expr extends Syntax implements IExpr {
        private isResultBool: bool;

        constructor (offset: parse.Symbol, isResultBool?: bool = false) {
            super(offset);

            this.isResultBool = isResultBool;
        }

        printAsCondition(p: quby.core.Printer) {
            if (this.isResultBool) {
                this.print(p);
            } else {
                super.printAsCondition(p);
            }
        }
    }

    export class NamedExpr extends NamedSyntax implements INamedExpr {
        private isResultBool: bool;

        constructor(offset: parse.Symbol, name: string, callName: string, isResultBool?: bool = false) {
            super(offset, name, callName);

            this.isResultBool = isResultBool;
        }

        printAsCondition(p: quby.core.Printer) {
            if(this.isResultBool) {
                this.print(p);
            } else {
                super.printAsCondition(p);
            }
        }
    }

    /*
    * If this is used from within a class, then it doesn't know if it's a
    * function call, 'foo()', or a method call, 'this.foo()'.
    *
    * This is issue is resolved through 'lateBind' where the class resolves
    * it during validation.
    *
    * This function presumes it's calling a function (not a method) until
    * it is told otherwise.
    *
    * There is also a third case. It could be a special class function,
    * such as 'get x, y' or 'getset img' for generating accessors (and other things).
    */
    export class FunctionCall extends NamedSyntax implements IFunctionMeta {
        private isMethodFlag: bool;

        private parameters: Parameters;
        private block: FunctionBlock;

        private functionGenerator:ISyntax;

        private isInsideExtensionClass: bool;

        constructor (sym: parse.Symbol, parameters: Parameters, block: FunctionBlock) {
            super(
                    sym,
                    sym.match,
                    quby.runtime.formatFun(
                            sym.match,
                            (parameters !== null) ?
                                    parameters.length :
                                    0
                    )
            );

            this.parameters = parameters;

            this.block = block;
            this.functionGenerator = null;

            this.isMethodFlag = false;

            this.isInsideExtensionClass = false;
        }

        getParameters() {
            return this.parameters;
        }

        getBlock() {
            return this.block;
        }

        print(p: quby.core.Printer) {
            if (this.functionGenerator) {
                this.functionGenerator.print(p);
            } else {
                if (this.isMethodFlag) {
                    p.append(quby.runtime.getThisVariable(this.isInsideExtensionClass), '.');
                }

                this.printFunCall(p);
            }
        }

        printFunCall(p: quby.core.Printer) {
            p.append(this.getCallName(), '(');
            this.printParams(p);
            p.append(')');
        }

        printParams(p: quby.core.Printer) {
            // parameters
            if (this.getNumParameters() > 0) {
                this.parameters.print(p);
                p.append(',');
            }

            // block parameter
            if (this.block !== null) {
                this.block.print(p);
            } else {
                p.append('null');
            }
        }

        setIsMethod() : void {
            this.isMethodFlag = true;
        }

        isMethod() : bool { return this.isMethodFlag }

        isFunction(): bool { return !this.isMethodFlag }

        isConstructor(): bool { return false }

        /**
         * This FunctionCall needs to declare it's self to the Validator,
         * so the Validator knows it exists. This is done in this call,
         * so it's detached from validating parameters and blocks.
         *
         * In practice, this means you can put your call to validate this as a method,
         * a 'this.method', or something else, by changing this method.
         *
         * By default, this states this is a function.
         */
        validateThis(v: quby.core.Validator) {
            v.useFun(this);
        }

        validate(v: quby.core.Validator) {
            var generator = null;

            if (v.isInsideClassDeclaration()) {
                this.functionGenerator = generator = getFunctionGenerator(v, this);

                if (generator === null) {
                    v.parseError(this.offset, "Function '" + this.getName() + "' called within the declaration of class '" + v.getCurrentClass().getClass().getName() + "', this is not allowed.");
                } else if (this.block !== null) {
                    v.parseError(this.offset, "'" + this.getName() + "' modifier of class '" + v.getCurrentClass().getClass().getName() + "', cannot use a block.");
                } else {
                    generator.validate(v);
                }
            } else {
                if (this.parameters !== null) {
                    this.parameters.validate(v);
                }

                this.isInsideExtensionClass = v.isInsideExtensionClass();

                this.validateThis(v);

                if (this.block != null) {
                    this.block.validate(v);
                }
            }
        }

        getNumParameters() {
            return (this.parameters !== null) ?
                    this.parameters.length :
                    0;
        }
    }

    export class MethodCall extends FunctionCall {
        private expr: IExpr;

        constructor (expr: IExpr, name: parse.Symbol, parameters: Parameters, block: FunctionBlock) {
            super(name, parameters, block);

            this.expr = expr;
            this.setIsMethod();
        }

        print(p: quby.core.Printer) {
            if (this.expr instanceof ThisVariable) {
                super.print(p);
            } else {
                this.printExpr(p);
                p.append('.');
                this.printFunCall(p);
            }
        }

        printExpr(p: quby.core.Printer) {
            p.append('(');
            this.expr.print(p);
            p.append(')');
        }

        validateThis(v: quby.core.Validator) {
            if ((this.expr instanceof ThisVariable) && v.isInsideClass()) {
                v.useThisClassFun(this);
            } else {
                v.useFun(this);
            }
        }

        validate(v: quby.core.Validator) {
            this.expr.validate(v);

            super.validate(v);
        }

        appendLeft(expr: IExpr) {
            if (this.expr !== null) {
                if (this.expr['appendLeft'] !== undefined) {
                    this.expr['appendLeft'](expr);
                }
            } else {
                this.expr = expr;
            }

            return this;
        }
    }

    export class SuperCall extends FunctionCall {
        private superKlassVal: quby.core.ClassValidator;
        private klassVal: quby.core.ClassValidator;

        constructor (name: parse.Symbol, parameters: Parameters, block: FunctionBlock) {
            super(name, parameters, block);

            this.klassVal = null;
            this.superKlassVal = null;
        }

        isConstructor() { return true }
        isMethod() { return false }
        isFunction() { return false }

        validate(v: quby.core.Validator) {
            if (v.ensureInConstructor(this, "Super can only be called from within a constructor.")) {
                this.klassVal = v.getCurrentClass();

                v.onEndValidate((v: quby.core.Validator) => {
                    var header = this.klassVal.getClass().getHeader();
                    var superCallName = header.getSuperCallName();
                    this.superKlassVal = v.getClass(superCallName);

                    if (this.superKlassVal == undefined) {
                        if (!quby.runtime.isCoreClass(header.getSuperName().toLowerCase())) {
                            v.parseError(this.offset, "Calling super to a non-existant super class: '" + header.getSuperName() + "'.");
                        }
                    } else if (!this.superKlassVal.hasNew(this)) {
                        var superName = this.superKlassVal.getClass().getName();

                        v.parseError(this.offset, "No constructor found with " + this.getNumParameters() + " parameters for super class: '" + superName + "'.");
                    }
                });
            }

            var parameters = this.getParameters(),
                block = this.getBlock();

            if ( parameters !== null) {
                parameters.validate(v);
            }

            if ( block !== null) {
                block.validate(v);
            }
        }

        print(p: quby.core.Printer) {
            if (this.superKlassVal !== undefined) {
                var superKlass = this.superKlassVal.getClass().getName();
                var superConstructor = quby.runtime.formatNew(superKlass, this.getNumParameters());

                p.append(superConstructor, '(', quby.runtime.THIS_VARIABLE, ',');
                this.printParams(p);
                p.append(')');
            }
        }
    }

    export class JSFunctionCall extends FunctionCall {
        constructor (sym: parse.Symbol, parameters: Parameters, block: FunctionBlock) {
            super(sym, parameters, block);

            this.setJSLiteral(true);
        }
    }

    /**
     * // todo
     */
    export class JSMethodCall extends FunctionCall {
        constructor( expr: IExpr, sym: parse.Symbol, params: Parameters, block: FunctionBlock ) {
            super(sym, params, block);

            this.setJSLiteral(true);
        }
    }

    /**
     * // todo
     */
    export class JSProperty extends Expr {
        constructor( expr: IExpr, sym: parse.Symbol ) {
            super(sym);

            this.setJSLiteral(true);
        }
    }

    export class JSNewInstance extends Syntax implements IExpr {
        private expr: IExpr;

        constructor( expr:IExpr ) {
            super(expr.getOffset());

            this.expr = expr;
            this.setJSLiteral(true);
        }

        validate(v: quby.core.Validator) {
            if (this.expr.isJSLiteral()) {
                if (v.ensureAdminMode(this, "cannot create JS instances in Sandbox mode")) {
                    this.expr.validate(v);
                }
            } else {
                v.parseError(this.getOffset(), "invalid 'new' instance expression");
            }
        }

        print(p: quby.core.Printer) {
            p.append('(new ');
            this.expr.print(p);
            p.append(')');
        }
    }

    export class NewInstance extends FunctionCall {
        private isExtensionClass: bool;
        private className: string;

        constructor (name, parameters, block) {
            super(name, parameters, block);

            this.isExtensionClass = false;
            this.className = quby.runtime.formatClass(name.match);

            this.setCallName(
                    quby.runtime.formatNew(name.match, this.getNumParameters())
            );
        }

        print(p: quby.core.Printer) {
            p.append(this.getCallName(), '(');

            // if a standard class,
            // make a new empty object and pass it in as the first parameter
            if ( ! this.isExtensionClass ) {
                p.append('new ', this.className, '(),');
            }

            this.printParams(p);

            p.append(')');
        }

        validate(v: quby.core.Validator) {
            var parameters = this.getParameters(),
                block = this.getBlock();

            if (parameters !== null) {
                parameters.validate(v);
            }

            if (block !== null) {
                block.validate(v);
            }

            // this can only be validated after the classes have been fully defined
            v.onEndValidate((v: quby.core.Validator) => {
                var klassVal = v.getClass(this.className);

                if (klassVal) {
                    var klass = klassVal.getClass();

                    if (
                           (!klassVal.hasNew(this))
                        || (klassVal.noNews() && this.getNumParameters() > 0)
                    ) {
                        if (klassVal.noNews() && klass.isExtensionClass) {
                            v.parseError(this.getOffset(), "Cannot manually create new instances of '" + klass.getName() + "', it doesn't have a constructor.");
                        } else {
                            v.parseError(this.offset, "Called constructor for class '" + klass.getName() + "' with wrong number of parameters: " + this.getNumParameters());
                        }
                    } else {
                        this.isExtensionClass = ( klass instanceof ExtensionClassDeclaration );
                    }
                } else {
                    v.parseError( this.offset, "Making new instance of undefined class: '" + this.getName() );
                }
            });
        }
    }

    export class ReturnStmt extends Syntax {
        private expr: IExpr;

        constructor (expr: IExpr) {
            super(expr.offset);

            this.expr = expr;
        }

        print(p: quby.core.Printer) {
            p.append('return ');

            this.expr.print(p);
        }
        validate(v: quby.core.Validator) {
            if (!v.isInsideFun() && !v.isInsideBlock()) {
                v.parseError(this.offset, "Return cannot be used outside a function or a block.");
            }

            this.expr.validate(v);
        }
    }

    export class YieldStmt extends Syntax {
        private parameters: Parameters;

        constructor (offsetObj, args?: Parameters = null) {
            super(offsetObj);

            this.parameters = args;
        }

        validate(v: quby.core.Validator) {
            v.ensureInFun(this, "Yield can only be used from inside a function.");

            if (this.parameters !== null) {
                this.parameters.validate(v);
            }
        }

        print(p: quby.core.Printer) {
            var paramsLen = (this.parameters !== null) ?
                    this.parameters.length :
                    0;

            p.appendPre('quby_ensureBlock(', quby.runtime.BLOCK_VARIABLE, ', ', ''+paramsLen, ');');
            p.append(quby.runtime.BLOCK_VARIABLE, '(');

            if (this.parameters !== null) {
                this.parameters.print(p);
            }

            p.append(')');
        }
    }

    export class FunctionBlock extends Syntax {
        private parameters: Parameters;
        private statements: Statements;
        private mismatchedBraceWarning: bool;

        constructor (parameters: Parameters, statements: Statements) {
            // only pass in the offset if we have it,
            // otherwise a null value
            var offset = parameters !== null ?
                    parameters.offset :
                    null;

            super(offset);

            this.parameters = parameters;
            this.statements = statements;

            this.mismatchedBraceWarning = false;
        }

        setMismatchedBraceWarning() {
            this.mismatchedBraceWarning = true;
        }

        print(p: quby.core.Printer) {
            p.append('function(');

            if (this.parameters !== null) {
                this.parameters.print(p);
            }

            p.append('){').flush();

            if (this.statements !== null) {
                this.statements.print(p);
            }

            p.append(
                    'return null;',
                    '}'
            );
        }

        validate(v: quby.core.Validator) {
            if (this.mismatchedBraceWarning) {
                v.strictError(this.getOffset(), "mismatched do-block syntax (i.e. 'do something() }')");
            }

            v.pushBlockScope();

            if (this.parameters !== null) {
                v.setParameters(true, false);
                this.parameters.validate(v);
                v.setParameters(false, false);
            }

            if (this.statements !== null) {
                this.statements.validate(v);
            }

            v.popScope();
        }

        getNumParameters(): number {
            return (this.parameters !== null) ?
                    this.parameters.length :
                    0;
        }
    }

    /*
     * todo: test a lambda as a condition, does it crash?
     *       I think this needs 'printCondition'.
         
        if ( def() end )
     */
    export class Lambda extends FunctionBlock {
        constructor (parameters: Parameters, statements: Statements) {
            super(parameters, statements);
        }

        print(p: quby.core.Printer) {
            p.append('(');
            super.print(p);
            p.append(')');
        }
    }

    /**
     * This is to allow an expression, mostly an operation, to swap it's
     * self out and rebalance the expression tree.
     *
     * It does this by copying it's self, then inserting the copy deeper
     * into the expression tree, and this then referenced the expression
     * tree now references the top of the tree.
     */
    export class BalancingExpr extends Expr {
        private balanceDone: bool;
        private proxyExpr: IExpr;

        constructor (offset: parse.Symbol, isResultBool) {
            super(offset, isResultBool);

            this.balanceDone = false;
            this.proxyExpr = null;
        }

        isBalanced(v: quby.core.Validator): bool {
            if (this.balanceDone) {
                return true;
            } else {
                var newExpr = this.rebalance();

                if (newExpr !== this) {
                    newExpr.validate(v);

                    return false;
                } else {
                    return true;
                }
            }
        }

        validate(v: quby.core.Validator) {
            if (this.proxyExpr !== null) {
                this.proxyExpr.validate(v);
            } else {
                super.validate(v);
            }
        }
        print(p: quby.core.Printer) {
            if (this.proxyExpr !== null) {
                this.proxyExpr.print(p);
            } else {
                super.print(p);
            }
        }
        printAsCondition(p: quby.core.Printer) {
            if (this.proxyExpr !== null) {
                this.proxyExpr.printAsCondition(p);
            } else {
                super.printAsCondition(p);
            }
        }

        rebalance(): IExpr {
            this.balanceDone = true;

            var expr = this.onRebalance();

            if (expr !== this) {
                this.proxyExpr = expr;

                return this;
            } else {
                return this;
            }
        }

        onRebalance(): IExpr {
            throw new Error("rebalance is not implemented");
        }
    }

    export class ExprParenthesis extends Syntax implements IExpr {
        private expr: IExpr;

        constructor (expr: IExpr) {
            super(expr.offset);

            this.expr = expr;
        }

        validate(v: quby.core.Validator) {
            this.expr.validate(v);
        }

        print(p: quby.core.Printer) {
            p.append('(');
            this.expr.print(p);
            p.append(')');
        }

        printAsCondition(p: quby.core.Printer) {
            p.append('(');
            this.expr.printAsCondition(p);
            p.append(')');
        }
    }

    /*
     * All single operations have precedence of 1.
     */
    export class SingleOp extends BalancingExpr implements IPrecedence {
        private expr : IExpr;
        private strOp: string;

        constructor (expr: IExpr, strOp: string, isResultBool: bool) {
            super(expr.offset, isResultBool);

            this.expr = expr;
            this.strOp = strOp;
        }

        getPrecedence() {
            return 1;
        }

        getExpr() {
            return this.expr;
        }

        validate(v: quby.core.Validator) {
            if (this.isBalanced(v)) {
                this.expr.validate(v);
            }
        }

        print(p: quby.core.Printer) {
            p.append('(', this.strOp, ' ');
            this.expr.print(p);
            p.append(' )');
        }

        onRebalance(): IExpr {
            // swap if expr has higher precedence then this
            var expr = this.expr;

            if (expr instanceof BalancingExpr) {
                expr = (<BalancingExpr>expr).rebalance();
            }

            if ( expr['getPrecedence'] !== undefined) {
                var pExpr = <IPrecedence><any>expr;

                if (pExpr.getPrecedence() > 1) {
                    var copy: SingleOp = util.clone(this);

                    copy.expr = pExpr.performBalanceSwap(copy, 1);

                    return expr;
                }
            } else {
                return this;
            }
        }

        performBalanceSwap(newLeft: BalancingExpr, precedence: number): IExpr {
            return this;
        }
    }

    export class SingleSub extends SingleOp {
        constructor (expr: IExpr) {
            super(expr, "-", false);
        }
    }

    export class Not extends SingleOp {
        constructor (expr) {
            super(expr, "!", true);
        }

        print(p: quby.core.Printer) {
            var temp = p.getTempVariable();

            p.appendPre('var ', temp, ';');

            p.append('(((', temp, '=');
            this.getExpr().print(p);
            p.append(') === null || ', temp, ' === false) ? true : false)');

            // needed to prevent memory leaks
            p.appendPost('delete ', temp, ';');
        }
    }

    /**
     * 0 is the tightest, most binding precendence, often
     * known as the 'highest precedence'.
     *
     * Higher numbers lower the priority of the precedence.
     * For example * binds tighter than +, so you might
     * assign the precedences:
     *
     *      + -> 3
     *      * -> 4
     *
     * ... giving * a higher precedence than +.
     *
     * @param left
     * @param right
     * @param strOp
     * @param isResultBool
     * @param precedence Lower is higher, must be a number.
     */
    export class Op extends BalancingExpr implements IPrecedence {
        private left: IExpr;
        private right: IExpr;
        private strOp: string;
        private precedence: number;

        constructor (left: IExpr, right: IExpr, strOp: string, isResultBool: bool, precedence: number) {
            var offset = left ? left.offset : null;

            super(offset, isResultBool);

            if (precedence === undefined) {
                throw new Error("undefined precedence given.");
            }
            this.precedence = precedence;

            this.left = left;
            this.right = right;

            this.strOp = strOp;
        }

        getLeft() {
            return this.left;
        }

        getRight() {
            return this.right;
        }

        print(p: quby.core.Printer) {
            var bracket = quby.compilation.hints.doubleBracketOps();

            if (bracket) {
                p.append('((');
            } else {
                p.append('(');
            }
            this.left.print(p);
            if (bracket) {
                p.append(')');
            }

            p.append(this.strOp);

            if (bracket) {
                p.append('(');
            }
            this.right.print(p);
            if (bracket) {
                p.append('))');
            } else {
                p.append(')');
            }
        }

        validate(v: quby.core.Validator) {
            if (this.isBalanced(v)) {
                this.right.validate(v);
                this.left.validate(v);
            }
        }

        onRebalance(): IExpr {
            var right = this.right;

            if ( right instanceof BalancingExpr ) {
                right = ( <BalancingExpr> <any> right ).rebalance();

                if (right instanceof BalancingExpr) {
                    var rightP = <IPrecedence> <any> right,
                        intPrecedence = this.precedence;

                    if (rightP.getPrecedence() > intPrecedence) {
                        var copy = <Op> util.clone(this);
                        copy.right = rightP.performBalanceSwap(copy, intPrecedence);

                        return right;
                    }
                }
            }

            return this;
        }

        performBalanceSwap(newLeft: BalancingExpr, precedence: number): IExpr {
            var left = this.left,
                oldLeft;

            /*
             * Left is either an node,
             * or it has higher precedence.
             */
            if ( this.left instanceof BalancingExpr ) {
                if ((<IPrecedence> <any> (left)).getPrecedence() <= precedence) {
                    oldLeft = left;

                    this.left = newLeft;

                    return oldLeft;
                } else {
                    return (<IPrecedence> <any> left).performBalanceSwap( newLeft, precedence );
                }
            } else {
                oldLeft = this.left;
                this.left = newLeft;

                return oldLeft;
            }
        }

        getPrecedence() {
            return this.precedence;
        }

        appendLeft(left: IExpr) {
            if (this.left !== null) {
                if (this.left['appendLeft'] !== undefined) {
                    this.left['appendLeft'](left);
                }
            } else if (left) {
                this.setOffset(left.offset);
                this.left = left;
            }

            return this;
        }
    }

    /**
     *_ Most of the operators just extend quby.syntax.Op,
     * without adding anything to it.
     *
     * This is a helper function to make that shorthand.
     *
     * @param {string} symbol The JS string symbol for when this operator is printed.
     * @param {number} precedence The precendence for this operator.
     * @param isResultBool Optional, true if the result is a boolean, otherwise it defaults to false.
     */
    var newShortOp = function (symbol: string, precedence: number, isResultBool: bool)
            : new (left: IExpr, right: IExpr) => Op
    {
        return <new (left: IExpr, right: IExpr) => Op> <any> function (left: IExpr, right: IExpr) {
            return new Op(left, right, symbol, isResultBool, precedence);
        }
    }

    /*
     * These are in order of precedence,
     * numbers and order taken from: http://en.wikipedia.org/wiki/Order_of_operations
     *
     * Lower is higher!
     */

    /* Shifting Operations */
    export var ShiftLeft  = newShortOp("<<", 5, false);
    export var ShiftRight = newShortOp(">>", 5, false);

    /* Greater/Less Comparison */
    export var LessThan = newShortOp("<", 6, true);
    export var LessThanEqual = newShortOp("<=", 6, true);
    export var GreaterThan = newShortOp(">", 6, true);
    export var GreaterThanEqual = newShortOp(">=", 6, true);

    /**
     * The JS version of 'instanceof', used as:
     * 
     *  if ( a #instanceof #Foo ) {
     */
    export class JSInstanceOf extends Op {
        constructor(left, right) {
            super( left, right, 'instanceof', true, 7);

            this.setJSLiteral(true);
        }

        validate(v:quby.core.Validator) {
            if (v.ensureAdminMode(this, "JS instanceof is not allowed in Sandbox mode")) {
                super.validate(v);
            }
        }
    }

    export class JSTypeOf extends SingleOp {
        constructor(right: IExpr) {
            super(right, "typeof", false);

            this.setJSLiteral(true);
        }

        validate(v: quby.core.Validator) {
            if (v.ensureAdminMode(this, "JS typeof is not allowed in Sandbox mode")) {
                super.validate(v);
            }
        }
    }

    /* Equality Comparison */
    export var Equality = newShortOp("==", 8, true);
    export var NotEquality = newShortOp("!=", 8, true);

    /* Bit Functions */
    export var BitAnd = newShortOp('&', 9, false);
    export var BitOr = newShortOp('|', 9, false);

    export class BoolOp extends Op {
        private useSuperPrint:bool;

        constructor(left:IExpr, right:IExpr, syntax:string, precedence:number) {
            super( left, right, syntax, false, precedence );

            this.useSuperPrint = false;
        }

        /**
         * Temporarily swap to the old print, then print as a condition,
         * then swap back.
         */
        print(p:quby.core.Printer) {
            if (this.useSuperPrint) {
                super.print( p );
            } else {
                this.useSuperPrint = true;
                this.printAsCondition( p );
                this.useSuperPrint = false;
            }
        }
    }

    export class BoolOr extends BoolOp {
        constructor(left:IExpr, right:IExpr) {
            super( left, right, '||', 12 );
        }

        print(p:quby.core.Printer) {
            var temp = p.getTempVariable();

            p.appendPre('var ', temp, ';');

            p.append('(((', temp, '=');
            this.getLeft().print(p);
            p.append(') === null || ', temp, ' === false) ? (');
            this.getRight().print(p);
            p.append(') : ', temp, ')');

            // needed to prevent memory leaks
            p.appendPost('delete ', temp, ';');
        }
    }

    export class BoolAnd extends BoolOp {
        constructor(left:IExpr, right:IExpr) {
            super( left, right, '&&', 11 );
        }

        print(p:quby.core.Printer) {
            var temp = p.getTempVariable();

            p.appendPre('var ', temp, ';');

            p.append('(((', temp, '=');
            this.getLeft().print(p);
            p.append(') === null || ', temp, ' === false) ? ', temp, ' : (');
            this.getRight().print(p);
            p.append('))');

            // needed to prevent memory leaks
            p.appendPost('delete ', temp, ';');
        }
    }

    /* ### Maths ### */

    export var Divide = newShortOp("/", 3, false);
    export var Mult = newShortOp("*", 3, false);
    export var Mod = newShortOp("%", 3, false);
    export var Add = newShortOp("+", 4, false);
    export var Sub = newShortOp("-", 4, false);

    export class Power extends Op {
        constructor(left:IExpr, right:IExpr) {
            super( left, right, "**", false, 2 );
        }

        print(p:quby.core.Printer) {
            p.append('Math.pow(');
            this.getLeft().print(p);
            p.append(',');
            this.getRight().print(p);
            p.append(')');
        }
    }

    /*
     * ### Assignments ###
     */

    /*
     * Has the highest precedence, giving it the lowest priority.
     */
    export class Mapping extends Op {
        constructor(left:IExpr, right:IExpr) {
            super( left, right, ':', false, 100 );
        }

        print(p:quby.core.Printer) {
            this.getLeft().print(p);
            p.append(',');
            this.getRight().print(p);
        }
    }

    export class Assignment extends Op {
        private isCollectionAssignment:bool;

        constructor(left:IExpr, right:IExpr) {
            super( left, right, '=', false, 14 );

            this.isCollectionAssignment = false;
        }

        setCollectionMode() {
            this.isCollectionAssignment = true;
        }

        validate( v:quby.core.Validator ) {
            var left = this.getLeft();

            if ( left['setAssignment'] === undefined ) {
                v.parseError( left.getOffset() || this.getOffset(), "Illegal assignment" );
            } else {
                (<IAssignable>left).setAssignment(v, this);

                super.validate(v);
            }
        }

        print( p:quby.core.Printer ) {
            if ( this.isCollectionAssignment ) {
                p.append('quby_setCollection(');
                this.getLeft().print(p);
                p.append(',');
                this.getRight().print(p);
                p.append(')');
            } else {
                this.getLeft().print(p);
                p.append('=');
                this.getRight().print(p);
            }
        }
    }

    /**
     * The super class for 'all' types of variables.
     * These include globals, fields, locals, and even 'this'!.
     */
    export class Variable extends NamedExpr implements IAssignable {
        private isAssignmentFlag: bool;

        constructor (identifier: parse.Symbol, callName: string) {
            super(identifier, identifier.match, callName);

            this.isAssignmentFlag = false;
        }

        isAssignment(): bool {
            return this.isAssignmentFlag;
        }

        print(p: quby.core.Printer) {
            p.append(this.getCallName());
        }

        setAssignment(v?:quby.core.Validator, parent?:Assignment): void {
            this.isAssignmentFlag = true;
        }
    }

    /*
     * ### Variables ###
     */

    export class LocalVariable extends Variable {
        private useVar:bool;

        constructor(identifier) {
            super( identifier, quby.runtime.formatVar(identifier.match) );

            this.useVar = false;
        }

        validate(v:quby.core.Validator) {
            // assigning to this variable
            if (this.isAssignment()) {
                v.assignVar(this);

                // blocks can alter local variables, allowing var prevents this.
                this.useVar = !v.isInsideBlock();

            // used as a parameter
            } else if (v.isInsideParameters()) {
                // it presumes scope has already been pushed by the function it's within
                if (v.containsLocalVar(this)) {
                    v.parseError(this.offset, "parameter variable name used multiple times '" + this.getName() + "'");
                }

                v.assignVar(this);

            // read from this, as non-parameter
            } else if (!this.isJSLiteral() && !v.containsVar(this)) {
                v.parseError(this.offset, "variable used before it's assigned to '" + this.getName() + "'");
            }
        }

        /**
         * When called, this will not validate that this
         * variable really does exist. Instead it will
         * presume it exists, with no check done at compile time.
         */
        print(p:quby.core.Printer) {
            if (this.isAssignment() && this.useVar) {
                p.append('var ');
            }

            super.print(p);
        }
    }

    export class GlobalVariable extends Variable {
        constructor(identifier) {
            super( identifier, quby.runtime.formatGlobal(identifier.match) );
        }

        print(p:quby.core.Printer) {
            if (this.isAssignment) {
                super.print(p);
            } else {
                p.append('quby_checkGlobal(', this.getCallName(), ',\'', this.getName(), '\')');
            }
        }

        validate(v:quby.core.Validator) {
            var name = this.getName();

            if (this.isAssignment) {
                // check if the name is blank, i.e. $
                if (name.length === 0) {
                    v.parseError(this.offset, "Global variable name is blank");
                } else {
                    v.assignGlobal(this);
                }
            } else {
                if (
                        v.ensureOutFunParameters(this, "global variable '" + name + "' used as function parameter") &&
                        v.ensureOutParameters(this, "global variable '" + name + "' used as block parameter")
                ) {
                    v.useGlobal(this);
                }
            }
        }
    }

    export class ParameterBlockVariable extends LocalVariable {
        constructor( identifier:parse.Symbol ) {
            super( identifier );
        }

        validate(v:quby.core.Validator) {
            v.ensureInFunParameters(this, "Block parameters must be defined within a functions parameters.");

            super.validate( v );
        }
    }

    export class FieldVariable extends Variable {
        private klass:IClassDeclaration;
        private isInsideExtensionClass: bool;

        constructor(identifier:parse.Symbol) {
            super( identifier, identifier.match.substring(1) );

            this.klass = null;
            this.isInsideExtensionClass = false;
        }

        validate(v:quby.core.Validator) {
            var name = this.getName();

            if (
                    v.ensureOutFunParameters(this, "class field '" + name + "' used as function parameter.") &&
                    v.ensureOutParameters(this, "object field '" + name + "' used as block parameter") &&
                    v.ensureInClass(this, "field '" + name + "' is used outside of a class, they can only be used inside.") &&
                    v.ensureInMethod(this, "class field '" + name + "' is used outside of a method.")
            ) {
                var klass = v.getCurrentClass().getClass();
                this.klass = klass;

                // set the correct field callName
                this.setCallName( 
                        quby.runtime.formatField( klass.getName(), name )
                );

                if (name.length === 0) {
                    v.parseError( this.offset, "no name provided for field of class " + klass.getName() );
                } else {
                    this.isInsideExtensionClass = v.isInsideExtensionClass();

                    this.validateField(v);
                }
            }
        }

        validateField(v:quby.core.Validator) {
            if (this.isAssignment) {
                v.assignField(this);
            } else {
                v.useField(this);
            }
        }

        print(p:quby.core.Printer) {
            if (this.klass) {
                var callName = this.getCallName();

                if (this.isAssignment) {
                    p.append(quby.runtime.getThisVariable(this.isInsideExtensionClass), '.', callName);
                } else {
                    var strName = this.getName() +
                            quby.runtime.FIELD_NAME_SEPERATOR +
                            this.klass.getName();

                    // this is about doing essentially either:
                    //     ( this.field == undefined ? error('my_field') : this.field )
                    //  ... or ...
                    //     getField( this.field, 'my_field' );
                    var thisVar = quby.runtime.getThisVariable(this.isInsideExtensionClass);
                    if (quby.compilation.hints.useInlinedGetField()) {
                        p.append(
                                '(',
                                    thisVar, ".", callName,
                                    '===undefined?quby.runtime.fieldNotFoundError(' + thisVar + ',"', strName, '"):',
                                    thisVar, ".", callName,
                                ')'
                        );
                    } else {
                        p.append(
                                "quby_getField(",
                                    thisVar, ".", callName, ',',
                                    thisVar, ",'",
                                    strName,
                                "')"
                        );
                    }
                }
            }
        }
    }

    export class ThisVariable extends Syntax {
        private isInsideExtensionClass: bool;

        constructor(sym:parse.Symbol) {
            super( sym );

            this.isInsideExtensionClass = false;
        }

        validate(v:quby.core.Validator) {
            if (
                    v.ensureOutFunParameters(this, "'this' used as function parameter") &&
                    v.ensureOutParameters(this, "'this' used as a block parameter")
            ) {
                v.ensureInMethod(this, "'this' is referenced outside of a class method (or you've named a variable 'this')");
            }

            this.isInsideExtensionClass = v.isInsideExtensionClass();
        }

        print(p:quby.core.Printer) {
            p.append(quby.runtime.getThisVariable(this.isInsideExtensionClass));
        }

        setAssignment(v:quby.core.Validator) {
            v.parseError( this.getOffset(), "cannot assign a value to 'this'" );
        }
    }

    export class JSVariable extends LocalVariable {
        constructor(identifier:parse.Symbol) {
            super( identifier );

            this.setCallName(identifier.match);
            this.setJSLiteral(true);
        }

        validate(v:quby.core.Validator) {
            if (
                    v.ensureOutBlock(this, "JS variable used as block parameter") &&
                    v.ensureAdminMode(this, "inlining JS values not allowed in sandboxed mode")
            ) {
                super.validate( v );
            }
        }
    }

    /*
     * ### Arrays ###
     */

    export class ArrayAccess extends Expr {
        private array:IExpr;
        private index:IExpr;

        private isAssignment:bool;

        constructor(array:IExpr, index:IExpr) {
            var offset = array !== null ?
                    array.offset :
                    null;

            super(offset);

            this.array = array;
            this.index = index;

            this.isAssignment = false;
        }

        print(p:quby.core.Printer) {
            if (this.isAssignment) {
                this.array.print(p);
                p.append(',');
                this.index.print(p);
            } else {
                p.append('quby_getCollection(');
                this.array.print(p);
                p.append(',');
                this.index.print(p);
                p.append(')');
            }
        }

        validate(v:quby.core.Validator) {
            this.index.validate(v);
            this.array.validate(v);
        }

        appendLeft(array) {
            if (this.array !== null) {
                if (this.array['appendLeft'] !== undefined) {
                    this.array['appendLeft'](array);
                }
            } else if (array) {
                this.setOffset(array.offset);
                this.array = array;
            }

            return this;
        }

        setAssignment(v:quby.core.Validator, parentAss:Assignment) {
            this.isAssignment = true;

            parentAss.setCollectionMode();
        }
    }

    export class ArrayLiteral extends Syntax {
        private parameters:IStatements;

        constructor(parameters?:IStatements) {
            var offset;
            if (parameters) {
                offset = parameters.offset;
            } else {
                parameters = null;
                offset = null;
            }

            super( offset );

            this.parameters = parameters;
        }

        getParameters() {
            return this.parameters;
        }

        print(p:quby.core.Printer) {
            p.append('(new QubyArray([');

            if (this.parameters !== null) {
                this.parameters.print(p);
            }

            p.append(']))');
        }

        validate(v:quby.core.Validator) {
            if (this.parameters !== null) {
                this.parameters.validate(v);
            }
        }
    }

    export class HashLiteral extends ArrayLiteral {
        constructor(parameters?:Mappings) {
            super(parameters);
        }

        print(p:quby.core.Printer) {
            p.append('(new QubyHash(');

            var parameters = this.getParameters();

            if ( parameters !== null) {
                parameters.print(p);
            }

            p.append('))');
        }
    }

    /* Literals */
    export class Literal extends Expr {
        private isTrue:bool;
        private match:string;

        constructor(sym:parse.Symbol, isTrue:bool, altMatch?:string) {
            this.match = altMatch ?
                    altMatch  :
                    sym.match ;

            super(sym);

            this.isTrue = isTrue;

        }

        getMatch() {
            return this.match;
        }

        validate(v:quby.core.Validator) {
            // do nothing
        }

        print(p:quby.core.Printer) {
            p.append(this.match);
        }

        /**
         * If this literal evaluates to true, then 'true' is printed.
         * Otherwise 'false'.
         */
        printAsCondition(p:quby.core.Printer) {
            if (this.isTrue) {
                p.append('true');
            } else {
                p.append('false');
            }
        }
    }

    export class Symbol extends Literal implements INamedExpr {
        private callName: string;

        constructor(sym:parse.Symbol) {
            super( sym, true );

            this.callName = quby.runtime.formatSymbol( sym.match );
        }

        getName() {
            return this.getMatch();
        }

        getCallName() {
            return this.callName;
        }

        validate(v:quby.core.Validator) {
            v.addSymbol(this);
        }
    }

    export class Number extends Literal {
        constructor(sym:parse.Symbol) {
            var matchStr:string;

            var origNum = sym.match,
                num = origNum.replace(/_+/g, ''),
                decimalCount = 0;

            // TODO validate num

            var matchStr:string = (num.indexOf('.') === -1) ?
                    "" + ((<number><any>num) | 0) :
                    "" + (parseFloat(num)) ;

            super( sym, true, matchStr );
        }
    }

    export class String extends Literal {
        constructor( sym:parse.Symbol ) {
            // escape the \n's
            super( sym, true, sym.match.replace(/\n/g, "\\n") );
        }
    }

    export class Bool extends Literal {
        constructor( sym:parse.Symbol ) {
            super(sym, (sym.match === 'true'));
        }
    }

    export class Null extends Literal {
        constructor( sym:parse.Symbol ) {
            super(sym, false, 'null');
        }
    }

    /*
     * = Function Generating Stuff =
     */

    /**
     * The base FunctionGenerator prototype. This does basic checks to ensure
     * the function we want to create actually exists.
     *
     * It handles storing common items.
     */
    class FunctionGenerator implements IFunctionMeta {
        public offset: parse.Symbol;
        public callName: string;

        private klass:quby.core.ClassValidator;

        // the name of this modifier, i.e. read, write, attr, get, set, getset
        private modifierName: string;

        // flag used for checking if it's a generator,
        // only used inside this FunctionGenerator
        private isGenerator: bool;

        // the name of the method this generates
        private name: string;

        private numParams: number;

        private isJSLiteralFlag: bool;

        constructor(obj:FunctionCall, methodName: string, numParams: number) {
            this.offset = obj.offset;

            this.klass = null;

            this.modifierName = obj.getName();

            this.isGenerator = true;

            this.name = methodName;
            this.numParams = numParams;

            this.callName = quby.runtime.formatFun(methodName, numParams);

            this.isJSLiteralFlag = false;
        }

        isJSLiteral() {
            return this.isJSLiteralFlag;
        }

        setJSLiteral(isLit: bool) {
            this.isJSLiteralFlag = isLit;
        }

        isConstructor() {
            return false;
        }

        isMethod() {
            return false;
        }

        isFunction() {
            return true;
        }

        getOffset() {
            return this.offset;
        }

        getClassValidator() : quby.core.ClassValidator {
            return this.klass;
        }

        getCallName(): string {
            return this.callName;
        }

        getName() : string {
            return this.name;
        }

        getModifier(): string {
            return this.modifierName;
        }

        /* This validation code relies on the fact that when a function
         * is defined on a class, it becomes the current function for that
         * callname, regardless of if it's a diplicate function or not.
         */
        validate(v: quby.core.Validator) {
            this.klass = v.getCurrentClass();

            // checks for duplicate before this get
            if (this.validateNameClash(v)) {
                v.defineFun(this);
                v.pushFunScope(this);

                this.validateInside(v);

                v.popScope();

                v.onEndValidate((v:quby.core.Validator) => this.onEndValidate(v));
            }
        }

        print(p: quby.core.Printer) { }

        getNumParameters() : number {
            return this.numParams;
        }

        onEndValidate(v: quby.core.Validator) {
            this.validateNameClash(v);
        }

        validateInside(v:quby.core.Validator) {
            // do nothing
        }

        validateNameClash(v:quby.core.Validator) {
            var currentFun = this.klass.getFun(this.callName);

            if (currentFun !== null && currentFun !== this) {
                // Give an error message depending on if we are
                // dealing with a colliding modifier or function.
                var errMsg = (currentFun instanceof FunctionGenerator) ?
                        "'" + this.modifierName + "' modifier in class '" + this.klass.getClass().getName() + "' clashes with modifier '" + (<FunctionGenerator>currentFun).getModifier() + '", for generating: "' + this.name + '" method' :
                        "'" + this.modifierName + "' modifier in class '" + this.klass.getClass().getName() + "' clashes with defined method: '" + this.name + '"';

                v.parseError(this.offset, errMsg);

                return false;
            } else {
                return true;
            }
        }
    }

    class FunctionAttrGenerator extends FunctionGenerator {
        private fieldName: string;
        private fieldObj:INamedExpr;
        private field:FieldVariable;

        private proto: new (sym: parse.Symbol) => FieldVariable;

        constructor(obj:FunctionCall, methodName:string, numParams:number, fieldObj:INamedExpr, proto:new(sym:parse.Symbol) => FieldVariable ) {
            var fieldName:string;
            if (fieldObj instanceof LocalVariable || fieldObj instanceof FieldVariable) {
                fieldName = ( <Variable>fieldObj ).getName();
            } else if (fieldObj instanceof Symbol) {
                fieldName = ( <Symbol>fieldObj ).getMatch();
            } else {
                fieldName = null;
            }

            var fullName = fieldName ? (methodName + util.str.capitalize(fieldName)) : methodName;

            // doesn't matter if fieldName is null for this, as it will be invalid laterz
            super(obj, fullName, numParams);

            this.proto = proto;

            // the name of our field, null if invalid
            this.fieldName = fieldName;
            this.fieldObj = fieldObj;

            // this is our fake field
            this.field = new this.proto( this.offset.clone(this.fieldName) );
        }

        withField(callback: (field:FieldVariable) => void ) {
            if (this.field !== null) {
                callback(this.field);
            }
        }

        validate(v:quby.core.Validator) {
            if (this.fieldName !== null) {
                super.validate(v);
            } else {
                v.parseError(this.fieldObj.offset, " Invalid parameter for generating '" + this.getName() + "' method");
            }
        }

        validateInside(v:quby.core.Validator) {
            this.field.validate(v);
        }
    }

    class FunctionReadGeneratorFieldVariable extends FieldVariable {
        constructor (sym:parse.Symbol) {
            super(sym);
        }

        validateField(v:quby.core.Validator) { } // we do this check ourselves later
    }

    class FunctionReadGenerator extends FunctionAttrGenerator {
        constructor(obj:FunctionCall, methodPrefix:string, field:INamedExpr) {
            super( obj, methodPrefix, 0, field, FunctionReadGeneratorFieldVariable );
        }

        onEndValidate(v:quby.core.Validator) {
            super.onEndValidate(v);

            this.withField((field:FieldVariable) => {
                var klass = this.getClassValidator();

                if (!klass.hasFieldCallName(field.getCallName())) {
                    v.parseError(this.offset, "field '" + field.getName() + "' never written to in class '" + klass.getClass().getName() + "' for generating method " + this.getName());
                }
            })
        }

        /*
         * This will be a method.
         */
        print(p:quby.core.Printer) {
            this.withField((field:FieldVariable) => {
                p.append(this.callName, '=function(){return ');
                field.print(p);
                p.append(';}');
            })
        }
    }

    class FunctionWriteGenerator extends FunctionAttrGenerator {
        constructor (obj:FunctionCall, methodPrefix: string, field:INamedExpr) {
            super(
                    obj,
                    methodPrefix,
                    1,
                    field,
                    FieldVariable
            )

            this.withField((field: FieldVariable) => field.setAssignment() );
        }

        onEndValidate(v:quby.core.Validator) {
            super.onEndValidate(v);

            this.withField((field: FieldVariable) => {
                if (!this.getClassValidator().hasFieldCallName(field.getCallName())) {
                    v.parseError(this.offset, "field '" + field.getName() + "' never written to in class '" + this.getClassValidator().getClass().getName() + "' for generating method " + this.getName() );
                }
            })
        }

        /*
         * This will be a method.
         */
        print(p:quby.core.Printer) {
            this.withField((field: FieldVariable) => {
                p.append(this.callName, '=function(t){return ');
                field.print(p);
                p.append('=t;');
                p.append('}');
            });
        }
    }

    class FunctionReadWriteGenerator {
        private getter: FunctionReadGenerator;
        private setter: FunctionWriteGenerator;

        constructor( obj:FunctionCall, getPre:string, setPre:string, fieldObj:INamedExpr ) {
            this.getter = new FunctionReadGenerator(obj, getPre, fieldObj);
            this.setter = new FunctionWriteGenerator(obj, setPre, fieldObj);
        }

        validate(v: quby.core.Validator) {
            this.getter.validate(v);
            this.setter.validate(v);
        }

        print(p:quby.core.Printer) {
            this.getter.print(p);
            this.setter.print(p);
        }
    }

    /*
     *  = Admin Inlining = 
     * 
     * and other manipulation of code.
     */

    export class PreInline extends Syntax {
        private isPrinted: bool;

        constructor(sym:parse.Symbol) {
            super(sym);

            this.isPrinted = false;
        }

        print(p:quby.core.Printer) {
            if (!this.isPrinted) {
                var match = this.offset.match;
                p.append(match.substring(6, match.length - 3));

                this.isPrinted = true;
            }
        }
        validate(v:quby.core.Validator) {
            v.ensureAdminMode( this, "inlining pre-JavaScript is not allowed outside of admin mode" );

            v.addPreInline(this);
        }
    }

    export class Inline extends Syntax {
        constructor (sym:parse.Symbol) {
            super(sym);
        }

        print(p:quby.core.Printer) {
            var match = this.offset.match;

            p.append(match.substring(3, match.length - 3));
        }
        printAsCondition(p:quby.core.Printer) {
            this.print(p);
        }
        validate(v:quby.core.Validator) {
            v.ensureAdminMode(this, "inlining JavaScript is not allowed outside of admin mode");
        }
    }
}