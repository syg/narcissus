function test() {
    var x = <HL>true;
    var y;
    function k() { y = false; }
    if (x) {
        k();
    }
    return !y;
}
test();
