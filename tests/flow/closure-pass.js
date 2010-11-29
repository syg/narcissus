function test() {
    var x = <H>true;
    var y = <H>false;
    function k() { y = false; }
    if (x) {
        k();
    }
    return !y;
}
test();
