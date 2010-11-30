function test() {
    var x = <HL>true;
    var y = <HL>false;
    function k() { y = false; }
    if (x) {
        k();
    }
    return !y;
}
test();
