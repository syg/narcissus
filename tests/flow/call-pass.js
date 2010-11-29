function test() {
    var foo = function () { return true; }
    var y;
    if (foo())
        y = false;
    return !y;
}

test();
