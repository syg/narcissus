function testCase(filename, shouldThrow) {
    var passed;
    var thrown = false;

    try {
        Narcissus.interpreter.evaluate(snarf(filename), filename, 1);
    } catch(e) {
        if (!(e instanceof Narcissus.interpreter.FlowError))
            throw e;
        thrown = true;
    }

    if (passed = (thrown === shouldThrow))
        print(filename + ": \033[1;32mPASSED\033[0m");
    else
        print(filename + ": \033[1;31mFAILED\033[0m");

    return passed;
}

testCase("upgrade-pass.js", false);
testCase("upgrade-fail.js", true);
testCase("call-pass.js", false);
testCase("call-fail.js", true);
testCase("closure-pass.js", false);
testCase("closure-fail.js", true);
