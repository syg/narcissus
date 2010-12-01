function test() {
    var foo = <HT>(function () { return true; });
    var y;
    if (foo())
        y = false;
    return !y;
}

test();
