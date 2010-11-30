function test() {
    var o = {};
    o.foo = true;
    var x = <HL>true;
    if (x) {
        o.foo = false;
    }
    return !o.foo;
}
test();
